"""Offline development tests. These are NOT live PaddleOCR API tests."""
import copy
import json
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
import pymupdf as fitz

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'helper'))
from repair.api import OfficialAPI, collect
from repair.engine import Engine
from repair.files import atomic_json, digest
from repair.pdf import generate, inspect, FONT
from repair.schema import normalize


def fixture(root):
    root = Path(root)
    source = root/'scan.pdf'
    rows = []
    with fitz.open() as document:
        for index in range(4):
            with fitz.open() as visual:
                page = visual.new_page(width=400,height=550)
                page.draw_rect(fitz.Rect(15,15,385,535),color=(.1,.3,.5),fill=(.96,.98,1))
                page.insert_font(fontname='CN',fontbuffer=FONT.buffer)
                page.insert_text((35,70),'中文测试 学术文献',fontname='CN',fontsize=16)
                page.insert_text((35,110),'LEFT column',fontsize=12)
                page.insert_text((225,110),'RIGHT column',fontsize=12)
                page.insert_text((35,160),'Table 1 | data 42',fontsize=12)
                image = page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).tobytes('png')
            page = document.new_page(width=400,height=550)
            page.insert_image(page.rect,stream=image)
            if index==1:
                page.set_rotation(90)
            if index==2:
                page.set_cropbox(fitz.Rect(20,30,380,520))
            if index==3:
                page.set_rotation(270)
            # Coordinates are in each displayed, cropped page image (2x points).
            lines = []
            offset = fitz.Point(page.cropbox.x0,page.cropbox.y0)
            for order,(text,box) in enumerate([
                ('中文测试 学术文献',[35,52,250,76]),
                ('LEFT column',[35,96,150,115]),
                ('RIGHT column',[225,96,350,115]),
                ('Table 1 | data 42',[35,146,200,165])]):
                r=fitz.Rect(box)
                points=[r.tl,r.tr,r.br,r.bl]
                points=[(point-offset)*page.rotation_matrix for point in points]
                # Keep line direction in display space; rotated writing is supported.
                lines.append(dict(text=text,quad=[[p.x*2,p.y*2] for p in points],order=order))
            rows.append(dict(index=index,width=page.rect.width*2,height=page.rect.height*2,lines=lines))
        document.set_metadata({'title':'Offline scan fixture'})
        document[0].add_text_annot((300,180),'Existing annotation')
        document.save(source)
    raw={'schema':'zotero-paddleocr/1','pages':rows}
    atomic_json(root/'scan.json',raw)
    (root/'scan.md').write_text(('中文测试 学术文献\nLEFT column\nRIGHT column\nTable 1 | data 42\n')*4,encoding='utf8')
    return source,raw


def official(raw):
    pages=[]
    for data in raw['pages']:
        pages.append({'prunedResult':{'width':data['width'],'height':data['height'],
            'overall_ocr_res':{'rec_texts':[l['text'] for l in data['lines']],
                               'rec_polys':[l['quad'] for l in data['lines']]},
            'parsing_res_list':[{'block_label':'text','block_content':'中文测试 学术文献',
                                'block_bbox':[0,0,data['width'],data['height']]}]},
            'markdown':{'text':'中文测试 学术文献 LEFT column RIGHT column Table 1 | data 42'}})
    return [{'result':{'layoutParsingResults':pages}}]


class FakeAPI:
    submissions=0
    uncertain=False
    records=[]
    batches={}
    def __init__(self,*args):
        pass
    def submit(self,path,model,batch,options):
        type(self).submissions+=1
        type(self).batches[batch]=[{'jobId':'remote-1','state':'done'}]
        if type(self).uncertain:
            type(self).uncertain=False
            raise httpx.ReadTimeout('intentionally lost response')
        return 'remote-1'
    def batch(self,batch):
        return type(self).batches.get(batch,[])
    def status(self,ident):
        return {'state':'done','resultUrl':{'jsonUrl':'https://results.example/result.jsonl'}}
    def results(self,status):
        return copy.deepcopy(type(self).records)
    def close(self):
        pass


class RepairTests(unittest.TestCase):
    def setUp(self):
        scratch=Path.cwd()/'work'/'test-temp'
        scratch.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=scratch)
        self.root=Path(self.temp.name)
        self.pdf,self.raw=fixture(self.root)
        self.md=(self.root/'scan.md').read_text(encoding='utf8')
        FakeAPI.submissions=0
        FakeAPI.uncertain=False
        FakeAPI.records=official(self.raw)
        FakeAPI.batches={}
        self.engines=[]

    def tearDown(self):
        for e in self.engines:
            e.close()
        self.temp.cleanup()

    def engine(self):
        e=Engine(self.root/'data',api_factory=FakeAPI)
        self.engines.append(e)
        e.configure({'token':'fixture-not-real','backupDir':str(self.root/'backups')})
        return e

    def wait(self,e,ident,state='ready'):
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            job=e.jobs[ident]
            if job['state']==state and ident not in e.running:
                return job
            if job['state'] in ('failed','paused','cancelled') and ident not in e.running:
                if state!=job['state']:
                    self.fail(str(job))
                return job
            time.sleep(.03)
        self.fail('task timed out')

    def test_unicode_rotation_crop_visual_identity_and_annotations(self):
        output=self.root/'searchable.pdf'
        report=generate(self.pdf,self.raw,self.md,output)
        self.assertEqual(report['inserted'],16)
        with fitz.open(self.pdf) as before,fitz.open(output) as after:
            for old,new in zip(before,after):
                self.assertEqual(old.get_pixmap().samples,new.get_pixmap().samples)
                self.assertIn('中文测试',new.get_text())
                self.assertIn('RIGHT column',new.get_text())
                self.assertEqual(new.rotation,old.rotation)
                self.assertEqual(new.cropbox,old.cropbox)
                # Transform extracted glyph bbox back to display coordinates for selection.
                self.assertTrue(new.search_for('LEFT'))
                for box in new.search_for('中文测试'):
                    self.assertTrue((box & fitz.Rect(0,0,new.cropbox.width,new.cropbox.height)).get_area()>0)
            self.assertEqual(len(list(after[0].annots())),1)
            self.assertEqual(after.metadata['title'],'Offline scan fixture')
            fonts=after[0].get_fonts()
            self.assertTrue(any(after.xref_get_key(f[0],'ToUnicode')[0]=='xref' for f in fonts))

    def test_missing_coordinates_and_bad_page_count_rejected(self):
        bad=copy.deepcopy(self.raw)
        del bad['pages'][0]['width']
        with self.assertRaises(ValueError):
            generate(self.pdf,bad,self.md,self.root/'bad.pdf')
        with self.assertRaises(ValueError):
            normalize(self.raw,3)
        self.assertFalse((self.root/'bad.pdf').exists())

    def test_page_progress_and_cancel_preserve_source(self):
        events=[]
        source_hash=digest(self.pdf)
        generate(self.pdf,self.raw,self.md,self.root/'progress.pdf',progress=lambda *args:events.append(args))
        self.assertEqual([e[1] for e in events if e[0]=='writing'],[0,1,2,3,4])
        self.assertEqual([e[1] for e in events if e[0]=='checking'],[0,1,2,3,4])
        self.assertIn(('saving',0,0),events)
        events.clear()
        with self.assertRaises(InterruptedError):
            generate(self.pdf,self.raw,self.md,self.root/'cancelled.pdf',
                     progress=lambda *args:events.append(args),
                     cancelled=lambda:any(e[0]=='writing' and e[1]>=1 for e in events))
        self.assertFalse((self.root/'cancelled.pdf').exists())
        self.assertEqual(digest(self.pdf),source_hash)

    def test_storage_modes_quota_unknown_and_index_warning(self):
        e=self.engine()
        for mode in ('hidden','archive','import','link'):
            e.configure({'sidecars':mode})
            self.assertEqual(e.config['sidecars'],mode)
        job=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'scan.json')))
        ready=self.wait(e,job['id'])
        self.assertEqual(ready['progress']['stage'],'ready')
        self.assertEqual(e.snapshot()['usage'],{})
        self.assertFalse(e.snapshot()['accountQuota']['available'])
        self.assertNotIn('remaining',e.snapshot()['accountQuota'])
        e.commit(job['id'])
        e.acknowledge(job['id'],indexed=False)
        self.assertTrue(e.jobs[job['id']]['indexPending'])
        self.assertEqual(FakeAPI.submissions,0)

    def test_official_adapter_and_block_order(self):
        pages,markdown=collect(FakeAPI.records)
        normalized,warnings=normalize({'result':{'layoutParsingResults':pages}},4,markdown)
        self.assertEqual(len(normalized),4)
        self.assertEqual(normalized[0]['lines'][0]['text'],'中文测试 学术文献')

    def test_legacy_paddle_result_uses_explicit_pdf_render_scale(self):
        legacy=copy.deepcopy(FakeAPI.records)
        for page in legacy[0]['result']['layoutParsingResults']:
            del page['prunedResult']['width']
            del page['prunedResult']['height']
        # Strict mode remains strict. Thumbnail sizes must never be guessed.
        with self.assertRaises(ValueError):
            generate(self.pdf,legacy,self.md,self.root/'bad-legacy.pdf')
        result=generate(self.pdf,legacy,self.md,self.root/'legacy.pdf',legacy_scale=2)
        self.assertEqual(result['inserted'],16)
        self.assertTrue(any('倍率 2' in w for w in result['warnings']))
        with fitz.open(self.pdf) as source,fitz.open(self.root/'legacy.pdf') as target:
            for before,after in zip(source,target):
                self.assertEqual(before.get_pixmap().samples,after.get_pixmap().samples)
                self.assertIn('中文测试',after.get_text())
        # A wrong scale that pushes coordinates beyond the page still fails.
        with self.assertRaises(ValueError):
            generate(self.pdf,legacy,self.md,self.root/'wrong-scale.pdf',legacy_scale=1)

    def test_legacy_scale_saved_in_merge_job_without_api(self):
        e=self.engine()
        e.configure({'legacyPDFScale':2})
        legacy=copy.deepcopy(FakeAPI.records)
        for page in legacy[0]['result']['layoutParsingResults']:
            del page['prunedResult']['width']
            del page['prunedResult']['height']
        atomic_json(self.root/'legacy.json',legacy)
        job=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'legacy.json')))
        self.wait(e,job['id'])
        self.assertEqual(e.jobs[job['id']]['legacyPDFScale'],2)
        self.assertEqual(FakeAPI.submissions,0)

    def test_merge_zero_network_commit_restore_and_dedup(self):
        e=self.engine()
        with patch.object(FakeAPI,'submit',side_effect=AssertionError('merge must never submit')):
            original=digest(self.pdf)
            job=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'scan.json')))
            job=self.wait(e,job['id'])
            e.commit(job['id'])
            self.assertNotEqual(digest(self.pdf),original)
            self.assertEqual(digest(job['backup']),original)
            e.acknowledge(job['id'])
            again=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'scan.json')))
            self.assertEqual(again['id'],job['id'])
            e.restore(self.pdf)
            self.assertEqual(digest(self.pdf),original)
            regenerated=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'scan.json')))
            self.assertEqual(regenerated['id'],job['id'])
            self.wait(e,regenerated['id'])
            e.commit(regenerated['id'])
            self.assertNotEqual(digest(self.pdf),original)

    def test_complete_ocr_cache_can_be_reused_without_token(self):
        e=self.engine()
        job=e.create(dict(mode='ocr',pdf=str(self.pdf)))
        self.wait(e,job['id'])
        duplicate=self.root/'cached-without-key.pdf'
        shutil.copyfile(self.pdf,duplicate)
        e.configure({'token':''})
        other=e.create(dict(mode='ocr',pdf=str(duplicate)))
        self.wait(e,other['id'])
        self.assertEqual(FakeAPI.submissions,1)

    def test_shutdown_pauses_and_restart_auto_resumes(self):
        e=self.engine()
        started=__import__('threading').Event()
        def interrupted_generation(*args,**kwargs):
            started.set()
            while not e.stopping:
                time.sleep(.01)
            raise InterruptedError()
        with patch('repair.engine.generate',interrupted_generation):
            job=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'scan.json')))
            self.assertTrue(started.wait(3))
            e.close()
            self.engines.remove(e)
        self.assertTrue(e.jobs[job['id']]['recoverable'])
        self.assertEqual(e.jobs[job['id']]['state'],'paused')
        recovered=self.engine()
        self.wait(recovered,job['id'])
        self.assertEqual(FakeAPI.submissions,0)

    def test_daily_threshold_pauses_without_submission(self):
        e=self.engine()
        e.configure({'dailyThreshold':1})
        job=e.create(dict(mode='ocr',pdf=str(self.pdf)))
        self.wait(e,job['id'],'paused')
        self.assertEqual(FakeAPI.submissions,0)

    def test_changed_source_cannot_be_overwritten(self):
        e=self.engine()
        job=e.create(dict(mode='merge',pdf=str(self.pdf),md=str(self.root/'scan.md'),json=str(self.root/'scan.json')))
        self.wait(e,job['id'])
        with open(self.pdf,'ab') as f:
            f.write(b'\n%external edit')
        edited=digest(self.pdf)
        with self.assertRaises(ValueError):
            e.commit(job['id'])
        self.assertEqual(digest(self.pdf),edited)

    def test_uncertain_submit_restart_recovers_without_repost(self):
        e=self.engine()
        FakeAPI.uncertain=True
        job=e.create(dict(mode='ocr',pdf=str(self.pdf)))
        self.wait(e,job['id'],'paused')
        self.assertEqual(FakeAPI.submissions,1)
        e.close()
        self.engines.remove(e)
        recovered=self.engine()
        recovered.resume(job['id'])
        self.wait(recovered,job['id'])
        self.assertEqual(FakeAPI.submissions,1)
        self.assertEqual(recovered.jobs[job['id']]['parts'][0]['remoteID'],'remote-1')

    def test_cache_reused_by_duplicate_attachment(self):
        e=self.engine()
        job=e.create(dict(mode='ocr',pdf=str(self.pdf)))
        self.wait(e,job['id'])
        duplicate=self.root/'other.pdf'
        shutil.copyfile(self.pdf,duplicate)
        other=e.create(dict(mode='ocr',pdf=str(duplicate)))
        self.wait(e,other['id'])
        self.assertEqual(FakeAPI.submissions,1)
        self.assertTrue(e.jobs[other['id']]['reused'])

    def test_uncertain_missing_batch_never_reposts(self):
        e=self.engine()
        FakeAPI.uncertain=True
        job=e.create(dict(mode='ocr',pdf=str(self.pdf)))
        self.wait(e,job['id'],'paused')
        FakeAPI.batches={}
        e.resume(job['id'])
        self.wait(e,job['id'],'paused')
        self.assertEqual(FakeAPI.submissions,1)

    def test_split_is_contiguous_without_repeated_pages(self):
        e=self.engine()
        e.config['concurrency']=1
        with patch.object(e,'schedule'):
            job=e.create(dict(mode='ocr',pdf=str(self.pdf)))
        with patch('repair.engine.MAX_PAGES',2):
            e._split(e.jobs[job['id']])
        parts=e.jobs[job['id']]['parts']
        self.assertEqual([(p['start'],p['end']) for p in parts],[(0,2),(2,4)])
        self.assertEqual(sum(inspect(p['path'])['pages'] for p in parts),4)

    def test_http_protocol_and_download_does_not_leak_token(self):
        calls=[]
        def transport(request):
            calls.append(request)
            if request.method=='POST':
                self.assertIn(b'name="optionalPayload"',request.content)
                self.assertIn(b'name="batchId"',request.content)
                return httpx.Response(200,json={'code':0,'data':{'jobId':'official-shape'}})
            if request.url.host=='results.example':
                self.assertNotIn('Authorization',request.headers)
                return httpx.Response(200,text=json.dumps(FakeAPI.records[0]))
            return httpx.Response(200,json={'code':0,'data':{'state':'done','resultUrl':{'jsonUrl':'https://results.example/a'}}})
        api=OfficialAPI('https://paddleocr.aistudio-app.com','secret-for-test',httpx.MockTransport(transport))
        self.assertEqual(api.submit(self.pdf,'PP-StructureV3','batch',{}),'official-shape')
        self.assertEqual(len(api.results(api.status('official-shape'))),1)
        self.assertEqual(len(calls),3)
        api.close()


if __name__=='__main__':
    unittest.main(verbosity=2)
