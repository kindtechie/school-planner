"""CP-SAT adapter. Structural conflicts are hard; user rules are switchable."""
import time
import threading
from collections import defaultdict
from ortools.sat.python import cp_model
from .domain import validate, events, all_rules, interval, selected, Invalid
from .audit import audit


def solve(document, seconds=30, preserve_weight=0, cancel_event=None):
    s = validate(document)
    evs = events(s)
    if not evs:
        raise Invalid('ابتدا حداقل یک جلسهٔ درسی اضافه کنید.')
    H, D = s['periods']*2, len(s['days'])
    for c in s['classes']:
        units = sum(e['duration'] for e in evs if c['id'] in e['classIds'])
        if units > H*D:
            raise Invalid(f"کلاس {c['name']} دارای {units/2:g} زنگ درسی است، اما ظرفیت هفته فقط {H*D/2:g} زنگ است.")
    model = cp_model.CpModel()
    choices, class_terms, teacher_intervals = [], defaultdict(list), defaultdict(list)
    by_event = defaultdict(list)
    old = {r['id']: r for r in (s.get('solution') or {}).get('schedule', [])}
    estimated = sum(len(e['teacherIds'] or [None])*len(e.get('starts', range(H*D))) for e in evs)
    if estimated > 250_000:
        raise Invalid('تعداد گزینه‌های برنامه خیلی زیاد است؛ گزینه‌های دبیر هر جلسه را محدود کنید یا مدرسه را به دوره‌های مستقل تقسیم کنید.')
    costs = []
    for e in evs:
        for tid in e['teacherIds'] or [None]:
            for h in e.get('starts', range(H*D)):
                if e['duration'] == 2 and h % 2:
                    continue
                v = model.new_bool_var(f"{e['id']}_{tid}_{h}")
                choice = (e, tid, h, v)
                choices.append(choice); by_event[e['id']].append(choice)
                for c in e['classIds']:
                    for occupied in range(h, h+e['duration']):
                        class_terms[c, occupied].append(v)
                if tid:
                    a, b = interval(s, e, h)
                    # Half-minutes remain exact even for a 75-minute period.
                    teacher_intervals[tid, h//H].append(model.new_optional_fixed_size_interval_var(int(a*2), int((b-a)*2), v, 'time'))
                previous = old.get(e['id'])
                if previous:
                    same = previous['start'] == h and previous['teacherId'] == tid
                    model.add_hint(v, int(same))
                    if preserve_weight and not same:
                        costs.append(preserve_weight*v)
        model.add_exactly_one([v for _, _, _, v in by_event[e['id']]])
    for values in class_terms.values():
        model.add_at_most_one(values)
    for spans in teacher_intervals.values():
        model.add_no_overlap(spans)

    assumptions = {}
    for ri, r in enumerate(all_rules(s)):
        flag = model.new_bool_var('rule_'+str(ri))
        if r['mode'] == 'hard':
            model.add_assumption(flag)
            assumptions[flag.index] = r['name']
        else:
            costs.append(r.get('weight', 10)*(1-flag))
        cs = [(e, t, h, v) for e, t, h, v in choices if selected(r, e, t)]
        daily = [sum(e['duration']*v for e, _, h, v in cs if h//H == d) for d in range(D)]
        def any_of(values):
            b = model.new_bool_var('any')
            model.add_max_equality(b, values or [0])
            return b
        present = [any_of([v for _, _, h, v in cs if h//H == d]) for d in range(D)]
        days = r.get('days') or list(range(D))
        lo, hi = r.get('min', 0), r.get('max', 0)
        kind = r['kind']
        if kind == 'allowed':
            allowed = set(r['slots'])
            for e, _, h, v in cs:
                if not set(range(h, h+e['duration'])) <= allowed:
                    model.add(v == 0).only_enforce_if(flag)
        elif kind == 'daily_load':
            for d in days:
                model.add(daily[d] >= lo).only_enforce_if(flag)
                model.add(daily[d] <= hi).only_enforce_if(flag)
        elif kind == 'day_count':
            model.add(sum(present) >= lo).only_enforce_if(flag)
            model.add(sum(present) <= hi).only_enforce_if(flag)
        elif kind == 'spread':
            for d in days:
                model.add(sum(v for _, _, h, v in cs if h//H == d) <= hi).only_enforce_if(flag)
        elif kind == 'no_single':
            for d in days:
                model.add(daily[d] != 2).only_enforce_if(flag)
        elif kind == 'balance':
            for a in days:
                for b in days:
                    model.add(daily[a]-daily[b] <= hi).only_enforce_if(flag)
        elif kind == 'day_compare':
            model.add(daily[r['dayA']] >= daily[r['dayB']]+lo).only_enforce_if(flag)
        elif kind == 'same_teacher':
            teachers = {t for _, t, _, _ in cs}
            model.add(sum(any_of([v for _, tid, _, v in cs if tid == t]) for t in teachers) <= 1).only_enforce_if(flag)
        elif kind == 'not_adjacent':
            # One event never conflicts with itself; half lessons within the same
            # period are allowed. The user selects one subject/class per rule.
            for d in range(D):
                for p in range(s['periods']-1):
                    left = any_of([v for _,_,h,v in cs if h//H == d and h%H//2 == p])
                    right = any_of([v for _,_,h,v in cs if h//H == d and h%H//2 == p+1])
                    model.add(left+right <= 1).only_enforce_if(flag)
        elif kind == 'paired_halves':
            singles = []
            occupied = []
            for p in range(H*D//2):
                pair = [any_of([v for e,_,h,v in cs if h <= p*2+k < h+e['duration']]) for k in range(2)]
                single = model.new_bool_var('unpaired')
                model.add_abs_equality(single, pair[0]-pair[1])
                singles.append(single); occupied.extend(pair)
            odd = model.new_int_var(0, 1, 'odd')
            model.add_modulo_equality(odd, sum(occupied), 2)
            model.add(sum(singles) <= odd).only_enforce_if(flag)
        elif kind in ['no_gaps', 'pattern', 'consecutive']:
            width = 1 if kind in ['pattern', 'consecutive'] or r.get('unit') == 'half' else 2
            for d in days:
                busy = [any_of([v for e, _, h, v in cs if h//H == d and any(h <= d*H+p*width+k < h+e['duration'] for k in range(width))]) for p in range(H//width)]
                if kind == 'pattern':
                    selectors = [model.new_bool_var('pattern') for _ in r['patterns']]
                    model.add(sum(selectors) == 1).only_enforce_if(flag)
                    for h in range(H):
                        model.add(busy[h] == sum(sel*p[h] for sel, p in zip(selectors, r['patterns']))).only_enforce_if(flag)
                else:
                    for p in range(1, len(busy)-1):
                        before, after = any_of(busy[:p]), any_of(busy[p+1:])
                        model.add(busy[p] >= before+after-1).only_enforce_if(flag)
            if kind == 'consecutive':
                model.add(sum(present) <= 1).only_enforce_if(flag)
    model.minimize(sum(costs))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1, min(float(seconds), 300))
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = 42
    if cancel_event and cancel_event.is_set():
        return dict(status='UNKNOWN', seconds=0, message='ساخت برنامه لغو شد.')
    finished = threading.Event()
    def watch_cancel():
        while not finished.wait(0.1):
            if cancel_event.is_set():
                solver.stop_search()
    if cancel_event:
        threading.Thread(target=watch_cancel, daemon=True).start()
    started = time.monotonic()
    try:
        status = solver.solve(model)
    finally:
        finished.set()
    result = dict(status=solver.status_name(status), seconds=round(time.monotonic()-started, 2))
    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        schedule = [dict(id=e['id'], start=h, teacherId=t) for e, t, h, v in choices if solver.value(v)]
        checked = audit(s, schedule)
        if not checked['valid']:
            raise RuntimeError('ممیزی مستقل برنامه ناموفق بود: '+str(checked['errors']))
        changes = sum(row != old[row['id']] for row in schedule if row['id'] in old)
        result.update(schedule=schedule, audit=checked, objective=solver.objective_value,
                      bound=solver.best_objective_bound, changed=changes, preserveWeight=preserve_weight)
    elif status == cp_model.INFEASIBLE:
        result['conflicts'] = [assumptions.get(i, 'تداخل ساختاری') for i in solver.sufficient_assumptions_for_infeasibility()]
        result['message'] = 'با الزام‌های فعلی برنامه ممکن نیست. قیود زیر را بررسی کنید؛ این مجموعه لزوماً کوچک‌ترین علت نیست.'
        if not result['conflicts']:
            result['message'] = 'ظرفیت زمان‌ها یا تداخل کلاس‌ها امکان چیدن همهٔ جلسات را نمی‌دهد.'
    else:
        result['message'] = 'در زمان تعیین‌شده پاسخ پیدا نشد؛ زمان حل را افزایش دهید. ناممکن بودن اثبات نشده است.'
    return result
