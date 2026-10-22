"""Read an existing PDF and test splitting in an isolated output folder; no network."""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'helper'))
from repair.engine import Engine

parser=argparse.ArgumentParser()
parser.add_argument('--pdf',required=True)
parser.add_argument('--out',required=True)
args=parser.parse_args()
out=Path(args.out).resolve()
if out.exists():
    raise SystemExit('Output must be a new folder')
e=Engine(out,api_factory=lambda *a: (_ for _ in ()).throw(AssertionError('network prohibited')))
j=dict(id='split-check',pages=0,parts=[],state='queued')
d=e.directory(j)
d.mkdir(parents=True)
shutil.copyfile(args.pdf,d/'source.pdf')
import pymupdf as fitz
with fitz.open(d/'source.pdf') as doc:
    j['pages']=len(doc)
start=time.monotonic()
try:
    e._split(j)
    report=dict(pages=j['pages'],seconds=round(time.monotonic()-start,3),parts=[
        dict(first=p['start']+1,last=p['end'],bytes=Path(p['path']).stat().st_size) for p in j['parts']])
    print(json.dumps(report,ensure_ascii=False))
finally:
    e.close()
