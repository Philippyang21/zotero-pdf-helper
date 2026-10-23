"""Prepare the existing Python helper resource for the template build (stdlib only)."""
import ast
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / 'plugin/manifest.json').read_text(encoding='utf8'))
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf8'))
    module = ast.parse((ROOT / 'helper/repair/__init__.py').read_text(encoding='utf8'))
    version = next(ast.literal_eval(n.value) for n in module.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == '__version__' for t in n.targets))
    assert manifest['version'] == package['version'] == version, 'Plugin/package/helper versions differ'
    assert manifest['applications']['zotero']['id'] == package['config']['addonID'] == 'paddleocr-pdf-repair@local.tools'
    assert manifest['applications']['zotero']['update_url'] == 'https://paddleocr-pdf-repair.invalid/updates.json'
    with zipfile.ZipFile(ROOT / 'plugin/helper-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted((ROOT / 'helper').rglob('*.py')):
            if '__pycache__' not in file.parts:
                archive.write(file, file.relative_to(ROOT / 'helper').as_posix())
        for name in ['requirements.txt', 'LICENSE']:
            archive.write(ROOT / name, name)


if __name__ == '__main__':
    main()
