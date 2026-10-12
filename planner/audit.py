"""Independent post-solve verification using only the exported schedule."""
from collections import Counter
from itertools import combinations
from .domain import all_rules, events, interval, selected


def rule_ok(s, rule, rows):
    H = s['periods']*2
    chosen = [(e, row) for e, row in rows if selected(rule, e, row['teacherId'])]
    loads = [sum(e['duration'] for e, row in chosen if row['start']//H == d) for d in range(len(s['days']))]
    occ = {h for e, row in chosen for h in range(row['start'], row['start']+e['duration'])}
    days = rule.get('days') or list(range(len(s['days'])))
    lo, hi = rule.get('min', 0), rule.get('max', 0)
    kind = rule['kind']
    if kind == 'allowed':
        return occ <= set(rule['slots'])
    if kind == 'daily_load':
        return all(lo <= loads[d] <= hi for d in days)
    if kind == 'day_count':
        return lo <= sum(n > 0 for n in loads) <= hi
    if kind == 'spread':
        return all(sum(row['start']//H == d for _, row in chosen) <= hi for d in days)
    if kind == 'no_single':
        return all(loads[d] != 2 for d in days)
    if kind == 'balance':
        return max(loads[d] for d in days)-min(loads[d] for d in days) <= hi
    if kind == 'day_compare':
        return loads[rule['dayA']] >= loads[rule['dayB']] + lo
    if kind == 'same_teacher':
        return len({row['teacherId'] for _, row in chosen}) <= 1
    if kind == 'pattern':
        return all([int(d*H+h in occ) for h in range(H)] in rule['patterns'] for d in days)
    if kind == 'not_adjacent':
        return all(not (a['id'] != b['id'] and ra['start']//H == rb['start']//H and abs(ra['start']%H//2-rb['start']%H//2) == 1) for (a,ra),(b,rb) in combinations(chosen,2))
    if kind == 'paired_halves':
        return sum((2*p in occ) != (2*p+1 in occ) for p in range(H*len(s['days'])//2)) <= len(occ)%2
    if kind in ['no_gaps', 'consecutive']:
        width = 1 if kind == 'consecutive' or rule.get('unit') == 'half' else 2
        for d in days:
            busy = [p for p in range(H//width) if any(d*H+p*width+h in occ for h in range(width))]
            if busy and max(busy)-min(busy)+1 != len(busy):
                return False
        return kind != 'consecutive' or sum(n > 0 for n in loads) <= 1
    raise ValueError(kind)


def audit(s, schedule):
    evs = {e['id']: e for e in events(s)}
    errors = []
    if Counter(r.get('id') for r in schedule) != Counter(evs.keys()):
        return dict(valid=False, errors=['جلسهٔ کم، اضافه یا تکراری در برنامه.'], rules=[])
    H = s['periods']*2
    rows = []
    occupied = Counter()
    for row in schedule:
        e = evs[row['id']]
        start = row.get('start')
        if type(start) is not int or not 0 <= start < H*len(s['days']) or (e['duration'] == 2 and start % 2) or ('starts' in e and start not in e['starts']):
            errors.append('زمان جلسه معتبر نیست: '+e['name'])
            continue
        if row.get('teacherId') not in (e['teacherIds'] or [None]):
            errors.append('دبیر نامعتبر: '+e['name'])
        for c in e['classIds']:
            for h in range(start, start+e['duration']):
                occupied[c, h] += 1
        rows.append((e, row))
    if any(n > 1 for n in occupied.values()):
        errors.append('تداخل کلاس در برنامه وجود دارد.')
    for (a, ra), (b, rb) in combinations(rows, 2):
        if not ra['teacherId'] or ra['teacherId'] != rb['teacherId'] or ra['start']//H != rb['start']//H:
            continue
        a0, a1 = interval(s, a, ra['start']); b0, b1 = interval(s, b, rb['start'])
        if a0 < b1 and b0 < a1:
            errors.append('تداخل ساعت واقعی دبیر: '+a['name']+' / '+b['name'])
    checks = []
    for r in all_rules(s):
        ok = rule_ok(s, r, rows)
        checks.append(dict(id=r['id'], name=r['name'], mode=r['mode'], satisfied=ok, weight=r.get('weight', 10)))
        if r['mode'] == 'hard' and not ok:
            errors.append(r['name'])
    return dict(valid=not errors, errors=errors, rules=checks,
                penalty=sum(r['weight'] for r in checks if r['mode'] == 'soft' and not r['satisfied']))
