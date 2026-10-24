"""Build and package a release without local test data, caches or browser profiles."""
import argparse
import hashlib
import json
import runpy
import shutil
import zipfile
from pathlib import Path
from scripts.distribution import source_files

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True)
args=parser.parse_args()
output=Path(args.out).resolve()
output.mkdir(parents=True,exist_ok=True)
runpy.run_path(str(ROOT/'build.py'),run_name='__main__')
version=json.loads((ROOT/'plugin/manifest.json').read_text(encoding='utf8'))['version']
stem=f'pdf-helper-{version}'
xpi=output/f'{stem}.xpi'
shutil.copyfile(ROOT.parent/xpi.name,xpi)
source=output/f'{stem}-source.zip'
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as archive:
    for file in source_files(ROOT):
        relative=file.relative_to(ROOT)
        archive.write(file,(Path(ROOT.name)/relative).as_posix())
bundle=output/f'{stem}-完整包'
bundle.mkdir(exist_ok=True)
bundle_files=[]
for path in (xpi,source):
    shutil.copyfile(path,bundle/path.name)
    bundle_files.append(bundle/path.name)
# Keep README/docs layout so all relative illustration and guide links work after extraction.
for file in [ROOT/'README.md',ROOT/'CHANGELOG.md',ROOT/'LICENSE',
             *(p for p in source_files(ROOT) if p.relative_to(ROOT).parts[0]=='docs')]:
    destination=bundle/file.relative_to(ROOT)
    destination.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(file,destination)
    bundle_files.append(destination)
hashes={p.relative_to(bundle).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(bundle_files)}
(bundle/'SHA256.json').write_text(json.dumps(hashes,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
bundle_files.append(bundle/'SHA256.json')
bundle_zip=output/f'{stem}-bundle.zip'
with zipfile.ZipFile(bundle_zip,'w',zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(bundle_files):
        archive.write(file,(Path(bundle.name)/file.relative_to(bundle)).as_posix())

# Check the distributed bytes, including the helper nested inside the XPI.
import io
with zipfile.ZipFile(xpi) as archive:
    assert archive.testzip() is None
    manifest=json.loads(archive.read('manifest.json'))
    assert manifest['version']==version
    for asset in ('content/text/options.js','content/text/protected.js','content/text/lineBreaks.js',
                  'content/text/whitespace.js','content/text/punctuation.js','content/text/index.js',
                  'content/text/annotations.js','content/textUI.js','content/textPreferences.js',
                  'content/textDialog.xhtml','content/textDialog.js','content/preferences.css',
                  'content/preferences.js','content/preferences.xhtml','content/updates.js',
                  'content/updatePreferences.js','update-config.json'):
        assert archive.read(asset)==(ROOT/'plugin'/asset).read_bytes()
    for size,icon in manifest['icons'].items():
        data=archive.read(icon)
        assert data[:8]==b'\x89PNG\r\n\x1a\n'
        assert int.from_bytes(data[16:20],'big')==int(size)
        assert int.from_bytes(data[20:24],'big')==int(size)
    with zipfile.ZipFile(io.BytesIO(archive.read('helper-source.zip'))) as helper:
        assert helper.testzip() is None
        assert f"__version__ = '{version}'" in helper.read('repair/__init__.py').decode('utf8')
        assert b'partConcurrency' in helper.read('repair/engine.py')
    assert not any(n.endswith(('.exe','.pyc','.pyo')) for n in archive.namelist())
    assert 'content/text/sidebar.js' not in archive.namelist()
with zipfile.ZipFile(source) as archive:
    assert archive.testzip() is None
    assert not any(any(p in {'work','__pycache__','.git'} for p in Path(n).parts) for n in archive.namelist())
with zipfile.ZipFile(bundle_zip) as archive:
    assert archive.testzip() is None
    for name,digest in hashes.items():
        assert hashlib.sha256(archive.read(bundle.name+'/'+name)).hexdigest()==digest,name
    for image in (ROOT/'docs/images').glob('*.png'):
        assert archive.read(bundle.name+'/docs/images/'+image.name)==image.read_bytes()
print(json.dumps({'version':version,'files':[
    dict(path=str(p),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
    for p in (xpi,source,bundle_zip)],'verified':True},ensure_ascii=False))
