"""Offline tests for bounded parallel OCR, remote progress and durable recovery."""
import copy
import json
import random
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
import pymupdf as fitz

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'helper'))
from repair.engine import Engine
from repair.files import atomic_json, digest
from test_repair import fixture, official


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.pdf,self.raw=fixture(self.root)
        self.records=official(self.raw)[0]['result']['layoutParsingResults']
        for n,page in enumerate(self.records):
            page['markdown']['text']=f'PAGE {n} 中文测试'
            page['prunedResult']['page_index']=n
        self.engines=[]

    def tearDown(self):
        for e in self.engines:
            e.close()
        self.temp.cleanup()

    def engine(self,api):
        e=Engine(self.root/'data',api_factory=lambda *args:api)
        self.engines.append(e)
        e.configure({'token':'offline-token'})
        return e

    def queued(self,e,pages=2,model='PP-StructureV3'):
        with patch.object(e,'schedule'):
            j=e.create(dict(mode='ocr',pdf=str(self.pdf),model=model))
        j=e.jobs[j['id']]
        with patch('repair.engine.MAX_PAGES',pages):
            e._split(j)
        return j

    def wait(self,e,j,state='ready'):
        until=time.monotonic()+10
        while time.monotonic()<until:
            if j['id'] not in e.running and j['state'] in ('ready','failed','paused','cancelled'):
                self.assertEqual(j['state'],state,j.get('message'))
                return
            time.sleep(.01)
        self.fail(f'task timed out: {j["state"]}')

    def api(self):
        pages=self.records
        class API:
            def __init__(self):
                self.lock=threading.Lock()
                self.posts=[]
                self.ranges={}
                self.polls={}
                self.active=0
                self.peak=0
            def submit(self,path,model,batch,options):
                bounds=path.stem.split('-')[1:]
                start,end=map(int,bounds) if bounds else (0,4)
                with self.lock:
                    ident=f'job-{len(self.posts)}'
                    self.posts.append((ident,batch))
                    self.ranges[ident]=(start,end)
                    self.active+=1
                    self.peak=max(self.peak,self.active)
                return ident
            def batch(self,batch):
                return [{'jobId':ident} for ident,b in self.posts if b==batch]
            def status(self,ident):
                return {'state':'done','ident':ident}
            def results(self,status):
                with self.lock:
                    start,end=self.ranges[status['ident']]
                    self.active-=1
                return [{'result':{'layoutParsingResults':copy.deepcopy(pages[start:end])}}]
            def close(self):
                pass
        return API()

    def test_two_segments_overlap_out_of_order_but_merge_in_page_order(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e)
        barrier=threading.Barrier(2)
        second_downloaded=threading.Event()
        original_status,original_results=api.status,api.results
        def status(ident):
            barrier.wait(3)
            if api.ranges[ident][0]==0:
                self.assertTrue(second_downloaded.wait(3))
            return original_status(ident)
        def results(value):
            result=original_results(value)
            if api.ranges[value['ident']][0]>0:
                second_downloaded.set()
            return result
        api.status,api.results=status,results
        e.schedule()
        self.wait(e,j)
        self.assertEqual(api.peak,2)
        self.assertEqual(len(api.posts),2)
        md=(e.directory(j)/'result.md').read_text(encoding='utf8')
        self.assertEqual([md.index(f'PAGE {n}') for n in range(4)],sorted(md.index(f'PAGE {n}') for n in range(4)))
        for n,part in enumerate(j['parts']):
            self.assertTrue(part.get('remoteID'))
            self.assertEqual(part['phase'],'done')
            self.assertIn('downloading',part['timing'])
        self.assertEqual(e.snapshot()['usage']['PP-StructureV3']['accepted'],4)

    def test_remote_numeric_string_progress_and_missing_progress_fallback(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e)
        e._remote_status(j,0,{'state':'running','extractProgress':{'totalPages':'2','extractedPages':'1'}})
        self.assertEqual(j['progress']['completed'],1)
        self.assertTrue(j['progress']['known'])
        self.assertEqual(j['progress']['resultPages'],0)
        self.assertIn('lastChecked',j['parts'][0])
        for value in ({}, {'totalPages':2,'extractedPages':99},{'totalPages':2,'extractedPages':'nan'}, {'totalPages':3,'extractedPages':1}):
            e._remote_status(j,0,{'state':'running','extractProgress':value})
            self.assertFalse(j['progress']['known'])
            self.assertEqual(j['progress']['completed'],0)
        self.assertNotIn('token',json.dumps(j))

    def test_live_timing_is_not_added_twice_and_wall_time_is_not_segment_sum(self):
        e=self.engine(self.api())
        j=self.queued(e)
        with patch('repair.engine.time.monotonic',return_value=10):
            e._activity(j,0,'pending')
            e._activity(j,1,'running')
            e.api_started[j['id']]=10
        with patch('repair.engine.time.monotonic',return_value=15):
            first=e.snapshot()['jobs'][0]
            second=e.snapshot()['jobs'][0]
            self.assertEqual(first['parts'][0]['timing']['pending'],5)
            self.assertEqual(second['apiSeconds'],5)
            self.assertNotIn('pending',j['parts'][0].get('timing',{}))
            e._activity(j,0,'running')
        with patch('repair.engine.time.monotonic',return_value=18):
            e._activity(j,0)
            self.assertEqual(j['parts'][0]['timing'],{'pending':5,'running':3})
            e._activity(j,1)
        e.api_started.clear()

    def test_global_limit_and_serial_preference(self):
        for concurrency in (1,2):
            api=self.api()
            e=self.engine(api)
            # Separate cache keys allow two different PDF tasks to run together.
            one=self.queued(e,1)
            two=self.queued(e,1,'PaddleOCR-VL-1.6')
            gate=threading.Event()
            entered=threading.Event()
            original=api.status
            def status(ident):
                entered.set()
                gate.wait(3)
                return original(ident)
            api.status=status
            e.config.update(concurrency=concurrency,partConcurrency=concurrency)
            e.schedule()
            self.assertTrue(entered.wait(3))
            time.sleep(.05)
            self.assertLessEqual(api.peak,concurrency)
            gate.set()
            self.wait(e,one)
            self.wait(e,two)
            self.assertLessEqual(api.peak,2)
            e.close()
            self.engines.remove(e)
            # Avoid old task/cache reuse in the next iteration.
            self.root=self.root/f'next-{concurrency}'
            self.root.mkdir()
            self.pdf,self.raw=fixture(self.root)

    def test_parallel_error_preserves_both_receipts_and_no_new_parts_start(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e,1)
        barrier=threading.Barrier(2)
        def failing_status(ident):
            barrier.wait(3)
            raise httpx.ReadTimeout('offline timeout')
        api.status=failing_status
        e.schedule()
        self.wait(e,j,'paused')
        self.assertEqual(len(api.posts),2)
        self.assertTrue(all(p.get('remoteID') for p in j['parts'][:2]))
        self.assertTrue(all(p['state']=='new' for p in j['parts'][2:]))
        persisted=json.loads((e.directory(j)/'job.json').read_text(encoding='utf8'))
        self.assertEqual([p.get('remoteID') for p in persisted['parts']],[p.get('remoteID') for p in j['parts']])
        e.close()
        self.engines.remove(e)
        api.status=lambda ident:{'state':'done','ident':ident}
        recovered=self.engine(api)
        recovered.resume(j['id'])
        self.wait(recovered,recovered.jobs[j['id']])
        self.assertEqual(len(api.posts),4)
        self.assertEqual(len({batch for ident,batch in api.posts}),4)

    def test_parallel_quota_reservations_prevent_over_submission(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e,1)
        e.config['dailyThreshold']=1
        e.schedule()
        self.wait(e,j,'paused')
        self.assertLessEqual(len(api.posts),1)
        self.assertLessEqual(sum(e.snapshot()['usage']['PP-StructureV3'].values()),1)

    def test_cancel_keeps_receipts_and_prevents_later_segments(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e,1)
        both=threading.Barrier(3)
        proceed=threading.Event()
        original=digest(self.pdf)
        def status(ident):
            both.wait(3)
            proceed.wait(3)
            return {'state':'running','extractProgress':{'totalPages':1,'extractedPages':0}}
        api.status=status
        e.schedule()
        both.wait(3)
        e.cancel(j['id'])
        proceed.set()
        self.wait(e,j,'cancelled')
        self.assertEqual(len(api.posts),2)
        self.assertTrue(all(p.get('remoteID') for p in j['parts'][:2]))
        self.assertTrue(all(p['state']=='new' for p in j['parts'][2:]))
        self.assertEqual(digest(self.pdf),original)

    def test_poll_timeout_pauses_without_losing_remote_receipt(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e)
        e.config['partConcurrency']=1
        api.status=lambda ident:{'state':'pending'}
        with patch('repair.engine.POLL_TIMEOUT',0):
            e.schedule()
            self.wait(e,j,'paused')
        self.assertIn('30 分钟',j['message'])
        self.assertEqual(len(api.posts),1)
        self.assertTrue(j['parts'][0].get('remoteID'))
        self.assertEqual(j['parts'][1]['state'],'new')
        api.status=lambda ident:{'state':'done','ident':ident}
        e.resume(j['id'])
        self.wait(e,j)
        self.assertEqual(len(api.posts),2)

    def test_lost_submit_response_is_reconciled_by_batch_in_parallel_mode(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e)
        original=api.submit
        first=True
        lock=threading.Lock()
        def submit(*args):
            nonlocal first
            ident=original(*args)
            with lock:
                if first:
                    first=False
                    raise httpx.ReadTimeout('lost response after server acceptance')
            return ident
        api.submit=submit
        e.schedule()
        self.wait(e,j,'paused')
        uncertain=[p for p in j['parts'] if p['state']=='intent']
        self.assertEqual(len(uncertain),1)
        self.assertFalse(uncertain[0].get('remoteID'))
        e.resume(j['id'])
        self.wait(e,j)
        self.assertEqual(len(api.posts),2)
        self.assertEqual(len({batch for ident,batch in api.posts}),2)

    def test_old_task_and_downloaded_segment_resume_without_reupload(self):
        api=self.api()
        e=self.engine(api)
        j=self.queued(e)
        part=j['parts'][1]
        ident=api.submit(Path(part['path']),j['model'],part['batchID'],{})
        part.update(remoteID=ident,state='accepted')
        atomic_json(e.directory(j)/'raw-0.json',[{'result':{'layoutParsingResults':self.records[:2]}}])
        # 0.1.6 journal has no per-phase timing or progress metadata.
        old_ranges=[(p['start'],p['end'],p['batchID']) for p in j['parts']]
        e.save(j)
        e.close()
        self.engines.remove(e)
        recovered=self.engine(api)
        self.wait(recovered,recovered.jobs[j['id']])
        self.assertEqual(len(api.posts),1)
        self.assertEqual(old_ranges,[(p['start'],p['end'],p['batchID']) for p in recovered.jobs[j['id']]['parts']])
        self.assertEqual(recovered.jobs[j['id']]['parts'][1]['remoteID'],ident)

    def test_actual_byte_packing_uses_three_segments_instead_of_binary_four(self):
        rng=random.Random(7)
        big=self.root/'size-fixture.pdf'
        with fitz.open() as doc:
            for n in range(6):
                page=doc.new_page(width=100,height=100)
                page.insert_image(page.rect,stream=fitz.Pixmap(fitz.csRGB,40,40,rng.randbytes(4800),False).tobytes('png'))
            doc.save(big)
        e=self.engine(self.api())
        with patch.object(e,'schedule'):
            j=e.create(dict(mode='ocr',pdf=str(big)))
        j=e.jobs[j['id']]
        with fitz.open(big) as doc,fitz.open() as sample:
            sample.insert_pdf(doc,from_page=0,to_page=1)
            two=len(sample.tobytes(deflate=True))
        with patch('repair.engine.MAX_BYTES',two+300),patch('repair.engine.TARGET_BYTES',two+100):
            e._split(j)
            self.assertEqual([(p['start'],p['end']) for p in j['parts']],[(0,2),(2,4),(4,6)])
            for part in j['parts']:
                self.assertLessEqual(Path(part['path']).stat().st_size,two+300)
                with fitz.open(big) as old,fitz.open(part['path']) as new:
                    for n,page in enumerate(new):
                        self.assertEqual(page.get_pixmap().samples,old[part['start']+n].get_pixmap().samples)


if __name__=='__main__':
    unittest.main()
