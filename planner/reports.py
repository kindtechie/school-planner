"""Offline, embedded-font Persian PDF export."""
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from .domain import events, Invalid
from .audit import audit


def pdf(s, view='school', target=''):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, A3, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
    import arabic_reshaper
    from bidi.algorithm import get_display
    solution = s.get('solution')
    if not solution or solution.get('stale'):
        raise Invalid('ابتدا یک برنامهٔ معتبر برای داده‌های فعلی بسازید.')
    report = audit(s, solution['schedule'])
    if not report['valid']:
        raise Invalid('برنامه برای خروجی معتبر نیست.')
    if view not in ['school', 'class', 'grade', 'teacher']:
        raise Invalid('نوع خروجی نامعتبر است.')
    font = Path(__file__).resolve().parent.parent/'web/assets/Persian.ttf'
    if 'Persian' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('Persian', str(font)))
    style = ParagraphStyle('fa', fontName='Persian', fontSize=8, leading=13, alignment=2)
    title_style = ParagraphStyle('title', parent=style, fontSize=15, leading=24)
    def para(text, title=False):
        lines = []
        # Wrap logical text before shaping, preserving Persian ordering per line.
        width = 155 if title else (82 if view == 'school' else 110)
        for line in str(text).translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')).split('\n'):
            words, current = line.split(), ''
            for word in words:
                trial = (current+' '+word).strip()
                visual = get_display(arabic_reshaper.reshape(trial))
                if current and pdfmetrics.stringWidth(visual, 'Persian', 8) > width:
                    lines.append(current); current = word
                else:
                    current = trial
            lines.append(current)
        return Paragraph('<br/>'.join(escape(get_display(arabic_reshaper.reshape(x))) for x in lines), title_style if title else style)
    teachers = {t['id']: t['name'] for t in s['teachers']}
    classes = {c['id']: c for c in s['classes']}
    evs = {e['id']: e for e in events(s)}
    rows = [(evs[r['id']], r) for r in solution['schedule']]
    if view == 'teacher':
        groups = [(t['name'], [c['id'] for c in s['classes']], t['id']) for t in s['teachers'] if not target or t['id'] == target]
    elif view == 'grade':
        groups = [('پایهٔ '+g, [c['id'] for c in s['classes'] if (c.get('grade') or 'بدون پایه') == g], None) for g in dict.fromkeys(c.get('grade') or 'بدون پایه' for c in s['classes']) if not target or target == g]
    elif view == 'class':
        groups = [(c['name'], [c['id']], None) for c in s['classes'] if not target or c['id'] == target]
    else:
        groups = [('برنامهٔ کل مدرسه', list(classes), None)]
    if not groups:
        raise Invalid('گزینه‌ای برای خروجی انتخاب نشده است.')
    size = landscape(A3 if view == 'school' else A4)
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=size, rightMargin=24, leftMargin=24, topMargin=26, bottomMargin=26, title=s['name'], author='برنامه‌ریز مدرسه')
    story = []
    H = s['periods']*2
    for gi, (label, cids, tid) in enumerate(groups):
        if gi:
            story.append(PageBreak())
        story.extend([para(s['name']+' — '+label, True), Spacer(1, 12)])
        if tid:
            table = [[para('روز')] + [para('زنگ '+str(p+1)) for p in range(s['periods'])]]
            for d, day in enumerate(s['days']):
                cells = [para(day)]
                for p in range(s['periods']):
                    matches = [(e, r) for e, r in rows if r['teacherId'] == tid and r['start']//H == d and r['start']%H//2 == p]
                    cells.append(para('\n'.join(e['name']+' · '+ '، '.join(classes[c]['name'] for c in e['classIds']) + (' (نیم‌زنگ '+str(r['start']%2+1)+')' if e['duration']==1 else '') for e,r in matches) or '—'))
                table.append(cells)
        else:
            table = [[para('روز / کلاس')] + [para('زنگ '+str(p+1)) for p in range(s['periods'])]]
            for d, day in enumerate(s['days']):
                for cid in cids:
                    cells = [para(day+'\n'+classes[cid]['name'])]
                    for p in range(s['periods']):
                        matches = [(e, r) for e, r in rows if cid in e['classIds'] and r['start']//H == d and r['start']%H//2 == p]
                        cells.append(para('\n'.join((e.get('titles', {}).get(cid) or e['name'])+'\n'+teachers.get(r['teacherId'], 'بدون دبیر')+(' · تجمیعی' if len(e['classIds'])>1 else '')+(' · نیم‌زنگ '+str(r['start']%2+1) if e['duration']==1 else '') for e,r in matches) or '—'))
                    table.append(cells)
        table = [list(reversed(row)) for row in table]
        widths = [(size[0]-48)/(s['periods']+1)]*(s['periods']+1)
        t = Table(table, colWidths=widths, repeatRows=1, hAlign='RIGHT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e0eeea')),('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#c4d3ce')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f5f8f6')])]))
        story.append(t)
    def footer(canvas, document):
        canvas.setFont('Persian', 8)
        canvas.drawCentredString(size[0]/2, 12, get_display(arabic_reshaper.reshape('صفحهٔ '+str(document.page))))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()
