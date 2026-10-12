import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
from http.cookiejar import CookieJar
from planner.domain import new_school, validate, Invalid
from planner.solver import solve
from planner.audit import audit
from planner.storage import Store, Conflict
from planner.server import Application


def fixture(days=2, periods=3):
    s = new_school('مدرسهٔ آزمایش')
    s.update(days=['شنبه', 'یکشنبه'][:days], periods=periods)
    s['classes'] = [dict(id='c', name='دهم ریاضی', grade='دهم', track='ریاضی', bells=[[450+p*105, 540+p*105] for p in range(periods)])]
    s['subjects'] = [dict(id='math', name='ریاضی')]
    s['teachers'] = [dict(id='t', name='دبیر آزمایش', subjectIds=['math'], availability=list(range(days*periods*2)), availabilityMode='hard')]
    s['lessons'] = [dict(id='l', name='ریاضی', subjectId='math', classIds=['c'], teacherIds=['t'], count=2, duration=2)]
    return s


def rule(kind, **kwargs):
    return dict(id='r', name='محدودیت آزمایشی', kind=kind, mode='hard', weight=20, enabled=True, **kwargs)


class SolverTests(unittest.TestCase):
    def test_basic_solution_and_tamper_detection(self):
        s=fixture(); result=solve(s, 3)
        self.assertEqual(result['status'], 'OPTIMAL')
        self.assertTrue(audit(s,result['schedule'])['valid'])
        bad=copy.deepcopy(result['schedule']);bad[1]['start']=bad[0]['start']
        self.assertFalse(audit(s,bad)['valid'])
        self.assertFalse(audit(s,bad[:1])['valid'])

    def test_hard_conflict_is_not_relaxed_and_soft_is_reported(self):
        s=fixture(); s['rules']=[rule('allowed', slots=[0,1])]
        result=solve(s,3)
        self.assertEqual(result['status'],'INFEASIBLE')
        self.assertIn('محدودیت آزمایشی',result['conflicts'])
        s['rules'][0]['mode']='soft'
        result=solve(s,3)
        self.assertEqual(result['status'],'OPTIMAL')
        self.assertEqual(result['audit']['penalty'],20)
        self.assertTrue(result['audit']['valid'])

    def test_joint_class_consumes_both_classes_once(self):
        s=fixture();s['classes'].append(dict(s['classes'][0],id='c2',name='یازدهم ریاضی'))
        s['lessons'][0]['classIds'].append('c2')
        s['lessons'].append(dict(s['lessons'][0],id='other',classIds=['c2'],count=1))
        result=solve(s,3)
        self.assertEqual(len(result['schedule']),3)
        self.assertTrue(result['audit']['valid'])

    def test_actual_clock_overlap_between_different_periods(self):
        s=fixture(periods=2)
        s['classes'].append(dict(s['classes'][0],id='c2',bells=[[510,600],[620,700]]))
        s['lessons']=[dict(s['lessons'][0],id='a',count=1,starts=[2]),dict(s['lessons'][0],id='b',count=1,classIds=['c2'],starts=[0])]
        self.assertEqual(solve(s,3)['status'],'INFEASIBLE')
        s['classes'][1]['bells']=[[440,540],[620,700]]
        self.assertIn(solve(s,3)['status'],['OPTIMAL','FEASIBLE'])

    def test_half_lessons_can_share_period(self):
        s=fixture(days=1,periods=1);s['lessons'][0]['duration']=1
        r=solve(s,3)
        self.assertEqual({x['start'] for x in r['schedule']},{0,1})

    def test_full_lesson_needs_both_halves_available(self):
        s=fixture(days=1,periods=2);s['lessons'][0]['count']=1;s['teachers'][0]['availability']=[0,2]
        self.assertEqual(solve(s,3)['status'],'INFEASIBLE')
        s['teachers'][0]['availabilityMode']='soft'
        self.assertEqual(solve(s,3)['audit']['penalty'],10)

    def test_all_rule_kinds(self):
        cases=[rule('daily_load',min=2,max=2),rule('day_count',min=2,max=2),rule('no_gaps'),rule('no_single'),rule('spread',min=0,max=1),rule('pattern',days=[0],patterns=[[1,1,1,1,0,0]]),rule('consecutive'),rule('same_teacher'),rule('balance',min=0,max=0),rule('day_compare',min=2,max=6,dayA=0,dayB=1)]
        for r in cases:
            with self.subTest(kind=r['kind']):
                s=fixture();s['rules']=[r]
                result=solve(s,3)
                self.assertIn(result['status'],['OPTIMAL','FEASIBLE'])
                self.assertTrue(result['audit']['valid'])
                self.assertTrue(result['audit']['rules'][0]['satisfied'])

    def test_gap_period_vs_half(self):
        s=fixture(days=1,periods=2);s['lessons'][0].update(duration=1,starts=[0,3])
        s['rules']=[rule('no_gaps',unit='period')]
        self.assertEqual(solve(s,3)['status'],'OPTIMAL')
        s['rules'][0]['unit']='half'
        self.assertEqual(solve(s,3)['status'],'INFEASIBLE')

    def test_select_specific_occurrence(self):
        s=fixture();s['rules']=[rule('allowed',slots=[4,5],eventIds=['l:1'])]
        r=solve(s,3)
        self.assertEqual(next(x['start'] for x in r['schedule'] if x['id']=='l:1'),4)

    def test_alternative_teacher_and_consistent_teacher(self):
        s=fixture();s['teachers'].append(dict(s['teachers'][0],id='t2',name='دبیر دوم'))
        s['teachers'][0]['availability']=[0,1];s['teachers'][1]['availability']=[2,3]
        s['lessons'][0]['teacherIds'].append('t2')
        self.assertEqual(solve(s,3)['status'],'OPTIMAL')
        s['rules']=[rule('same_teacher')]
        self.assertEqual(solve(s,3)['status'],'INFEASIBLE')

    def test_preserve_old_schedule(self):
        s=fixture();s['solution']=solve(s,3)
        r=solve(s,3,100)
        self.assertEqual(r['changed'],0)
        self.assertEqual(r['objective'],0)

    def test_invalid_input(self):
        for mutate in [lambda s:s['lessons'][0].update(classIds=['missing']),lambda s:s['teachers'][0].update(subjectIds=[]),lambda s:s['classes'][0].update(bells=[[1,2]]),lambda s:s.update(schemaVersion=999)]:
            s=fixture();mutate(s)
            with self.assertRaises(Invalid):validate(s)

    def test_disabled_rule_not_enforced(self):
        s=fixture();s['rules']=[rule('allowed',slots=[])];s['rules'][0]['enabled']=False
        self.assertEqual(solve(s,3)['status'],'OPTIMAL')

    def test_not_adjacent(self):
        s=fixture(days=1,periods=3);s['rules']=[rule('not_adjacent')]
        r=solve(s,3)
        self.assertEqual({x['start'] for x in r['schedule']},{0,4})

    def test_shutdown_cancels_search(self):
        cancelled=threading.Event();cancelled.set()
        result=solve(fixture(),300,cancel_event=cancelled)
        self.assertEqual(result['status'],'UNKNOWN')
        self.assertNotIn('schedule',result)

    def test_pair_free_half_periods(self):
        s=fixture(days=1,periods=3);s['lessons'][0].update(duration=1,count=3)
        s['rules']=[rule('paired_halves')]
        result=solve(s,3)
        self.assertTrue(result['audit']['valid'])
        s['lessons'][0]['starts']=[0,2,4]
        self.assertEqual(solve(s,3)['status'],'INFEASIBLE')
        s['rules'][0]['mode']='soft'
        self.assertEqual(solve(s,3)['audit']['penalty'],20)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(Path(self.tmp.name)/'schools.sqlite3')
    def tearDown(self):self.tmp.cleanup()
    def test_reopen_history_conflicts_and_stale(self):
        s=self.store.save(fixture(),create=True)
        s['solution']=solve(s,3);s=self.store.save(s,solved=True)
        self.assertFalse(s['solution'].get('stale',False))
        before=copy.deepcopy(s);s['name']='نام جدید';s=self.store.save(s)
        self.assertTrue(s['solution']['stale'])
        with self.assertRaises(Conflict):self.store.save(before)
        reopened=Store(self.store.path);self.assertEqual(reopened.get(s['id'])['name'],'نام جدید')
        restored=reopened.restore(s['id'],before['revision'])
        self.assertEqual(restored['name'],'مدرسهٔ آزمایش')
        self.assertTrue(restored['solution']['audit']['valid'])
    def test_reject_corrupt_imported_solution(self):
        s=fixture();s['solution']={'schedule':[]}
        with self.assertRaises(Invalid):self.store.save(s,create=True)
        self.assertEqual(self.store.list(),[])
    def test_bounded_history(self):
        s=self.store.save(fixture(),create=True)
        for i in range(34):s['name']=str(i);s=self.store.save(s)
        self.assertEqual(len(self.store.history(s['id'])),30)

    def test_solving_old_snapshot_cannot_replace_new_input(self):
        old=self.store.save(fixture(),create=True)
        current=copy.deepcopy(old);current['name']='ویرایش جدید';self.store.save(current)
        old['solution']=solve(old,3)
        with self.assertRaises(Conflict):self.store.save(old,solved=True)
        self.assertEqual(self.store.get(old['id'])['name'],'ویرایش جدید')


class PDFTests(unittest.TestCase):
    def test_all_views_and_stale_rejection(self):
        from planner.reports import pdf
        s=fixture();s['solution']=solve(s,3)
        for view in ['school','class','grade','teacher']:
            data=pdf(s,view)
            self.assertTrue(data.startswith(b'%PDF-'))
            self.assertIn(b'/FontFile2',data)
        s['solution']['stale']=True
        with self.assertRaises(Invalid):pdf(s)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.server=Application(Store(Path(self.tmp.name)/'db'))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.client=build_opener(HTTPCookieProcessor(CookieJar()));self.client.open(self.server.launch_url).read()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.server.pool.shutdown();self.thread.join();self.tmp.cleanup()
    def post(self,path,data):
        return json.load(self.client.open(Request(self.server.origin+'/api/'+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})))
    def test_auth_origin_import_and_export(self):
        with self.assertRaises(HTTPError) as ctx:urlopen(self.server.origin+'/api/state')
        self.assertEqual(ctx.exception.code,403)
        s=self.post('import',{'school':fixture()})
        exported=json.load(self.client.open(self.server.origin+'/api/export?id='+s['id']))
        self.assertEqual(exported['name'],s['name'])
        other=self.post('import',{'school':exported});self.assertNotEqual(s['id'],other['id'])
        request=Request(self.server.origin+'/api/create',data=b'{"name":"x"}',headers={'Content-Type':'application/json','Origin':'http://evil.example'})
        with self.assertRaises(HTTPError) as ctx:self.client.open(request)
        self.assertEqual(ctx.exception.code,403)
    def test_invalid_import_leaves_database_intact(self):
        self.post('create',{'name':'اول'})
        with self.assertRaises(HTTPError):self.post('import',{'school':{'name':'bad'}})
        self.assertEqual(len(self.server.store.list()),1)


if __name__=='__main__':unittest.main()
