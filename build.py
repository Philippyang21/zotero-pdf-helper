"""Build a lightweight XPI using the machine's existing Python (stdlib only)."""
import hashlib
import json
import ast
import zipfile
from pathlib import Path
from scripts.distribution import plugin_files

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT/'plugin/manifest.json').read_text(encoding='utf8'))
version = manifest['version']
metadata=manifest['applications']['zotero']
assert metadata.get('id')
assert metadata.get('update_url') == 'https://paddleocr-pdf-repair.invalid/updates.json'
assert metadata.get('strict_max_version')
module=ast.parse((ROOT/'helper/repair/__init__.py').read_text(encoding='utf8'))
helper_version=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='__version__' for t in n.targets))
assert version==helper_version,'Plugin/helper versions must agree'
archive = ROOT/'plugin/helper-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as out:
    for file in sorted((ROOT/'helper').rglob('*.py')):
        if '__pycache__' not in file.parts:
            out.write(file,file.relative_to(ROOT/'helper').as_posix())
    out.write(ROOT/'requirements.txt','requirements.txt')
    if (ROOT/'LICENSE').exists():
        out.write(ROOT/'LICENSE','LICENSE')
xpi = ROOT.parent/f'pdf-helper-{version}.xpi'
with zipfile.ZipFile(xpi,'w',zipfile.ZIP_DEFLATED) as out:
    for file in plugin_files(ROOT):
        out.write(file,file.relative_to(ROOT/'plugin').as_posix())
    for name in ['LICENSE','README.md',*[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'docs').glob('*.md'))]]:
        if (ROOT/name).exists():
            out.write(ROOT/name,name)
print(json.dumps(dict(xpi=str(xpi),bytes=xpi.stat().st_size,
                     sha256=hashlib.sha256(xpi.read_bytes()).hexdigest()),ensure_ascii=False))
