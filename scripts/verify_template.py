"""Check template output against source resources before exposing an XPI for packaging."""
import hashlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.distribution import plugin_files


def main():
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf8'))
    version = package['version']
    built = ROOT / '.scaffold/build' / f'pdf-helper-{version}.xpi'
    expected = {p.relative_to(ROOT / 'plugin').as_posix(): p.read_bytes() for p in plugin_files(ROOT)}
    for file in [ROOT / 'LICENSE', ROOT / 'README.md', *sorted((ROOT / 'docs').rglob('*'))]:
        if file.is_file() and (file.name == 'LICENSE' or file.suffix in {'.md', '.png', '.txt'}):
            expected[file.relative_to(ROOT).as_posix()] = file.read_bytes()
    with zipfile.ZipFile(built) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        files = {name for name in names if not name.endswith('/')}
        compiled = 'content/scripts/paddleocrrepair.js'
        assert files == set(expected) | {compiled}, {'extra': files - set(expected) - {compiled}, 'missing': set(expected) - files}
        assert len(names) == len(set(names)), 'Duplicate archive entries'
        for name, data in expected.items():
            if name == 'manifest.json':
                assert json.loads(archive.read(name)) == json.loads(data), name
            else:
                assert archive.read(name) == data, name
        bundle = archive.read(compiled)
        assert b'createRepairRuntime' in bundle and b'PDFHelperAddon' in bundle
        assert b'__env__' not in bundle
        assert json.loads(archive.read('manifest.json'))['version'] == version
        with zipfile.ZipFile(io.BytesIO(archive.read('helper-source.zip'))) as helper:
            assert helper.testzip() is None
            assert f"__version__ = '{version}'" in helper.read('repair/__init__.py').decode('utf8')
        assert not any(name.endswith(('.exe', '.pyc', '.pyo', '.pdf', '.sqlite')) for name in files)
    xpi = ROOT.parent / built.name
    shutil.copyfile(built, xpi)
    print(json.dumps({'xpi': str(xpi), 'version': version, 'bytes': xpi.stat().st_size,
                      'sha256': hashlib.sha256(xpi.read_bytes()).hexdigest(), 'templateVerified': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
