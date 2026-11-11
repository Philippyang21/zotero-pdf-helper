"""Opt-in GPU/CPU smoke test using only a supplied example and a new scratch directory."""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path
import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'helper'))
from repair.engine import Engine
from repair.files import digest
from repair.local_structure import probe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True)
    parser.add_argument('--sample', type=Path, required=True, help='one scanned page with recognisable text')
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--device', default='auto')
    parser.add_argument('--exercise-resume', action='store_true', help='cancel after page one and resume that job')
    parser.add_argument('--warm', action='store_true', help='recognize a second PDF with the same loaded model')
    parser.add_argument('--no-formula', action='store_true')
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(dir=args.scratch))
    pdf = root/'fixture.pdf'
    with pymupdf.open(args.sample) as source, pymupdf.open() as doc:
        doc.insert_pdf(source, from_page=0, to_page=0)
        doc.insert_pdf(source, from_page=0, to_page=0)
        doc.save(pdf)
    before = digest(pdf)
    def reject_cloud(*args):
        raise AssertionError('Local OCR called the cloud API')
    engine = Engine(root/'profile', api_factory=reject_cloud)
    options = dict(localPython=args.environment, localDevice=args.device, localFormula=not args.no_formula)
    try:
        check = probe(options)
        engine.configure(dict(**options,localKeepModel=args.warm))
        job = engine.create(dict(pdf=str(pdf), mode='local', **options))
        jid = job['id']
        checkpoint = engine.directory(job)/'local-pages/0.json'
        if args.exercise_resume:
            deadline = time.monotonic()+300
            while not checkpoint.exists() and time.monotonic()<deadline:
                assert engine.snapshot()['jobs'][0]['state'] not in ('failed','paused','cancelled')
                time.sleep(.1)
            stamp = checkpoint.stat().st_mtime_ns
            engine.cancel(jid)
            deadline = time.monotonic()+10
            while jid in engine.running and time.monotonic()<deadline:
                time.sleep(.1)
            assert engine.snapshot()['jobs'][0]['state']=='cancelled'
            assert digest(pdf)==before
            engine.resume(jid)
        deadline = time.monotonic()+900
        while time.monotonic()<deadline:
            job = engine.snapshot()['jobs'][0]
            if job['state'] in ('ready','failed','paused','cancelled'):
                break
            time.sleep(.3)
        assert job['state']=='ready', job['message']
        if args.exercise_resume:
            assert checkpoint.stat().st_mtime_ns == stamp
        assert job['report']['touched']==[0,1] and not job['parts']
        with pymupdf.open(job['output']) as out, pymupdf.open(pdf) as original:
            for n,page in enumerate(out):
                assert page.get_pixmap().samples == original[n].get_pixmap().samples
                assert len(page.get_text().strip()) > 10
        raw = json.loads(Path(job['json']).read_text(encoding='utf8'))
        assert all(page['model_settings']['use_formula_recognition']==(not args.no_formula) for page in raw)
        assert [page['page_index'] for page in raw]==[0,1]
        assert Path(job['md']).read_text(encoding='utf8').strip()
        assert not engine.snapshot()['usage']
        engine.commit(jid)
        assert digest(pdf)==job['outputHash']
        engine.acknowledge(jid)
        engine.restore(pdf)
        assert digest(pdf)==before
        assert job['localRun']['device']==check['device']
        assert not job['localRun']['reused']
        if args.warm:
            from shutil import copyfile
            other = root/'second.pdf'
            copyfile(pdf, other)
            second = engine.create(dict(pdf=str(other),mode='local',**options))
            deadline = time.monotonic()+900
            while time.monotonic()<deadline:
                second = engine.snapshot()['jobs'][-1]
                if second['state'] in ('ready','failed','paused','cancelled'):
                    break
                time.sleep(.3)
            assert second['state']=='ready', second['message']
            assert second['localRun']['reused']
            engine.configure(dict(**options,localKeepModel=False))
            assert engine.model_session.process is None
        print(json.dumps(dict(check=check,warm=args.warm,pages=job['pages'],lines=job['report']['inserted'],
                              seconds=job['localSeconds'],resumed=args.exercise_resume,restored=True,scratch=str(root)),ensure_ascii=False))
    finally:
        engine.close()


if __name__=='__main__':
    main()
