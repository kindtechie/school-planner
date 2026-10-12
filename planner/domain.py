"""Versioned document contract, reference validation and event expansion."""
import copy
import uuid

VERSION = 1
DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه']
COLLECTION_NAMES = {'classes': 'کلاس‌ها', 'subjects': 'درس‌ها', 'teachers': 'دبیران', 'lessons': 'جلسات', 'rules': 'محدودیت‌ها'}
KINDS = {
    'allowed': 'زمان‌های مجاز / زمان ثابت',
    'daily_load': 'حداقل و حداکثر زنگ در روز',
    'day_count': 'تعداد روزهای حضور',
    'no_gaps': 'بدون فاصلهٔ خالی',
    'no_single': 'جلوگیری از روز تک‌زنگ',
    'spread': 'سقف تکرار جلسه در روز',
    'pattern': 'الگوی حضور روزانه',
    'consecutive': 'جلسات پشت سر هم در یک روز',
    'same_teacher': 'یک دبیر برای همهٔ جلسات',
    'balance': 'توازن تعداد زنگ روزانه',
    'not_adjacent': 'جلسات انتخابی در زنگ‌های پشت سر هم نباشند',
    'paired_halves': 'نیم‌زنگ‌های آزاد تا حد امکان یک زنگ کامل شوند',
    'day_compare': 'تدریس بیشتر در یک روز نسبت به روز دیگر',
}


class Invalid(ValueError):
    pass


def new_school(name='مدرسهٔ جدید'):
    return dict(schemaVersion=VERSION, id=str(uuid.uuid4()), name=name, days=DAYS[:],
                periods=4, classes=[], subjects=[], teachers=[], lessons=[], rules=[],
                solution=None, revision=0)


def require(ok, message):
    if not ok:
        raise Invalid(message)


def integer(value, lo, hi):
    return type(value) is int and lo <= value <= hi


def validate(raw):
    require(isinstance(raw, dict), 'فایل مدرسه باید یک شیء معتبر باشد.')
    s = copy.deepcopy(raw)
    require(s.get('schemaVersion') == VERSION, 'نسخهٔ فایل مدرسه پشتیبانی نمی‌شود.')
    require(isinstance(s.get('name'), str) and 0 < len(s['name'].strip()) <= 150, 'نام مدرسه معتبر نیست.')
    require(isinstance(s.get('id'), str) and 0 < len(s['id']) <= 100, 'شناسهٔ مدرسه معتبر نیست.')
    require(isinstance(s.get('days'), list) and 1 <= len(s['days']) <= 7 and all(isinstance(d, str) and 0 < len(d) < 30 for d in s['days']), 'روزهای هفته معتبر نیستند.')
    require(len(set(s['days'])) == len(s['days']), 'نام روزها تکراری است.')
    require(integer(s.get('periods'), 1, 10), 'تعداد زنگ باید بین ۱ تا ۱۰ باشد.')
    H = len(s['days']) * s['periods'] * 2
    indices = {}
    for collection in ['classes', 'subjects', 'teachers', 'lessons', 'rules']:
        rows = s.get(collection)
        require(isinstance(rows, list) and len(rows) <= 1000, 'فهرست نامعتبر: '+COLLECTION_NAMES[collection])
        index = {}
        for row in rows:
            require(isinstance(row, dict), 'رکورد نامعتبر در '+COLLECTION_NAMES[collection])
            rid = row.get('id')
            require(isinstance(rid, str) and 0 < len(rid) <= 100 and rid not in index, 'شناسهٔ خالی یا تکراری در '+COLLECTION_NAMES[collection])
            require(isinstance(row.get('name'), str) and 0 < len(row['name'].strip()) <= 200, 'نام خالی یا نامعتبر در '+COLLECTION_NAMES[collection])
            index[rid] = row
        indices[collection] = index

    def refs(values, collection, empty=True):
        require(isinstance(values, list) and all(isinstance(v, str) and v in indices[collection] for v in values), 'ارجاع حذف‌شده یا نامعتبر به '+COLLECTION_NAMES[collection]+'؛ ابتدا جلسات و قیود وابسته را ویرایش کنید.')
        require(len(set(values)) == len(values) and (empty or values), 'انتخاب تکراری یا خالی در '+COLLECTION_NAMES[collection])

    def slots(values):
        require(isinstance(values, list) and all(integer(x, 0, H-1) for x in values) and len(set(values)) == len(values), 'زمان انتخاب‌شده خارج از تقویم مدرسه است.')

    for c in s['classes']:
        require(all(isinstance(c.get(k, ''), str) and len(c.get(k, '')) <= 100 for k in ['grade', 'track']), 'پایه یا رشته معتبر نیست.')
        bells = c.get('bells')
        require(isinstance(bells, list) and len(bells) == s['periods'], 'زنگ‌بندی کلاس باید با تعداد زنگ مدرسه برابر باشد.')
        prev = 0
        for b in bells:
            require(isinstance(b, list) and len(b) == 2 and all(integer(x, 0, 1440) for x in b) and prev <= b[0] < b[1] and b[1]-b[0] >= 2, 'ساعت زنگ‌های کلاس نامعتبر یا دارای تداخل است.')
            prev = b[1]
    for t in s['teachers']:
        refs(t.get('subjectIds', []), 'subjects')
        slots(t.get('availability', list(range(H))))
        require(t.get('availabilityMode', 'hard') in ['hard', 'soft'], 'نوع حضور دبیر نامعتبر است.')
        require(integer(t.get('availabilityWeight', 10), 1, 1000), 'وزن حضور معتبر نیست.')
    count = 0
    for l in s['lessons']:
        refs(l.get('classIds'), 'classes', False)
        refs(l.get('teacherIds'), 'teachers')
        refs([l.get('subjectId')], 'subjects', False)
        require(integer(l.get('count'), 1, 100) and integer(l.get('duration'), 1, 2), 'تعداد جلسه یا طول جلسه معتبر نیست.')
        require(isinstance(l.get('titles', {}), dict) and all(c in l['classIds'] and isinstance(v, str) and len(v) <= 150 for c, v in l.get('titles', {}).items()), 'عنوان‌های کلاس تجمیعی معتبر نیستند.')
        for tid in l['teacherIds']:
            require(l['subjectId'] in indices['teachers'][tid].get('subjectIds', []), 'درس «'+l['name']+'» در تخصص دبیر انتخابی نیست.')
        if 'starts' in l:
            slots(l['starts'])
        count += l['count']
    require(count <= 1500, 'حداکثر ۱۵۰۰ جلسه در هر مدرسه پشتیبانی می‌شود.')
    for r in s['rules']:
        require(r.get('kind') in KINDS, 'نوع محدودیت پشتیبانی نمی‌شود.')
        require(type(r.get('enabled', True)) is bool, 'وضعیت قید معتبر نیست.')
        require(r.get('mode') in ['hard', 'soft'], 'قید باید ترجیح یا الزام باشد.')
        require(integer(r.get('weight', 10), 1, 1000), 'وزن ترجیح باید بین ۱ تا ۱۰۰۰ باشد.')
        for key, collection in [('teacherIds', 'teachers'), ('classIds', 'classes'), ('subjectIds', 'subjects'), ('lessonIds', 'lessons')]:
            refs(r.get(key, []), collection)
        require(isinstance(r.get('eventIds', []), list) and all(i in {e['id'] for e in events(s)} for i in r.get('eventIds', [])), 'جلسهٔ انتخابی در قید پیدا نشد.')
        require(isinstance(r.get('days', []), list) and all(integer(d, 0, len(s['days'])-1) for d in r.get('days', [])), 'روز قید معتبر نیست.')
        require(r.get('unit', 'period') in ['period', 'half'], 'واحد فاصله معتبر نیست.')
        if r['kind'] == 'allowed':
            slots(r.get('slots', []))
        if r['kind'] in ['daily_load', 'day_count', 'spread', 'balance', 'day_compare']:
            for key in ['min', 'max']:
                require(integer(r.get(key, 0), 0, 3000), 'حداقل و حداکثر باید عدد صحیح نامنفی باشند.')
            require(r.get('min', 0) <= r.get('max', 0), 'حداقل از حداکثر بیشتر است.')
        if r['kind'] == 'day_compare':
            require(all(integer(r.get(k), 0, len(s['days'])-1) for k in ['dayA', 'dayB']), 'روزهای مقایسه معتبر نیستند.')
        if r['kind'] == 'pattern':
            patterns = r.get('patterns', [])
            require(isinstance(patterns, list) and 1 <= len(patterns) <= 100 and all(isinstance(p, list) and len(p) == s['periods']*2 and all(x in [0, 1] for x in p) for p in patterns), 'الگو باید برای هر نیم‌زنگ صفر یا یک داشته باشد.')
    return s


def events(s):
    return [dict(l, id=f"{l['id']}:{i}", lessonId=l['id']) for l in s['lessons'] for i in range(l['count'])]


def selected(rule, event, teacher):
    return (not rule.get('teacherIds') or teacher in rule['teacherIds']) and all([
        not rule.get('eventIds') or event['id'] in rule['eventIds'],
        not rule.get('classIds') or bool(set(rule['classIds']) & set(event['classIds'])),
        not rule.get('subjectIds') or event['subjectId'] in rule['subjectIds'],
        not rule.get('lessonIds') or event['lessonId'] in rule['lessonIds'],
    ])


def all_rules(s):
    rules = [r for r in s['rules'] if r.get('enabled', True)]
    for t in s['teachers']:
        rules.append(dict(id='availability:'+t['id'], name='حضور '+t['name'], kind='allowed',
                          teacherIds=[t['id']], slots=t.get('availability', list(range(len(s['days'])*s['periods']*2))),
                          mode=t.get('availabilityMode', 'hard'), weight=t.get('availabilityWeight', 10)))
    return rules


def interval(s, event, start):
    """Actual occupied wall-clock interval, conservatively covering joint classes."""
    p, half = divmod(start % (s['periods']*2), 2)
    classes = {c['id']: c for c in s['classes']}
    spans = []
    for cid in event['classIds']:
        a, b = classes[cid]['bells'][p]
        mid = (a+b)/2
        spans.append((a if half == 0 else mid, b if event['duration'] == 2 or half else mid))
    return min(a for a, _ in spans), max(b for _, b in spans)
