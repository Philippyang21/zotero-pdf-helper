"""Stdlib-only regression checks for safe source distribution and version tooling."""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.distribution import source_files, plugin_files


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.scratch = ROOT / 'work/test-temp'
        self.scratch.mkdir(parents=True, exist_ok=True)

    def test_source_distribution_omits_private_data_and_environments(self):
        with tempfile.TemporaryDirectory(dir=self.scratch) as temporary:
            root = Path(temporary)
            include = ['README.md', 'LICENSE', '.gitignore', '.gitattributes', 'plugin/content/updates.js',
                       'plugin/update-config.json', 'helper/repair/server.py', 'tests/test_updates.cjs',
                       'release/update-manifest.json', 'scripts/distribution.py', 'docs/RELEASING.md',
                       'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
                       'zotero-plugin.config.ts', 'src/index.ts', 'typings/global.d.ts', 'docs/images/install.png']
            exclude = ['work/browser/Preferences', 'work/private.json', '.env', '.git/config',
                       '.venv/secret.py', 'helper/__pycache__/server.pyc', 'plugin/helper-source.zip',
                       'plugin/document.pdf', 'plugin/debug.log', 'plugin/zotero.sqlite',
                       'plugin/key.pem', 'plugin/model.onnx', 'personal/data.json', 'unknown.py',
                       '.scaffold/build/addon/manifest.json', 'node_modules/third-party/index.js']
            for name in include + exclude:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture', encoding='utf8')
            actual = {p.relative_to(root).as_posix() for p in source_files(root)}
            self.assertEqual(actual, set(include))

    def test_xpi_includes_only_resources_and_generated_helper(self):
        with tempfile.TemporaryDirectory(dir=self.scratch) as temporary:
            root = Path(temporary)
            include = ['plugin/manifest.json', 'plugin/helper-source.zip', 'plugin/content/updates.js']
            exclude = ['plugin/private.pdf', 'plugin/debug.log', 'plugin/unexpected.zip',
                       'plugin/__pycache__/cached.pyc', 'plugin/.env']
            for name in include + exclude:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture', encoding='utf8')
            self.assertEqual({p.relative_to(root).as_posix() for p in plugin_files(root)}, set(include))

    def test_version_tool_only_updates_an_unpublished_candidate_and_rejects_bad_versions(self):
        spec = importlib.util.spec_from_file_location('set_version', ROOT / 'scripts/set_version.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(dir=self.scratch) as temporary:
            root = Path(temporary)
            for name in ['plugin', 'helper/repair', 'release']:
                (root / name).mkdir(parents=True, exist_ok=True)
            manifest = {'version': '1.9.0', 'applications': {'zotero': {'strict_min_version': '10.0', 'strict_max_version': '10.0.*'}}}
            (root / 'plugin/manifest.json').write_text(json.dumps(manifest), encoding='utf8')
            (root / 'package.json').write_text(json.dumps({'version': '1.9.0'}), encoding='utf8')
            (root / 'helper/repair/__init__.py').write_text("__version__ = '1.9.0'\n", encoding='utf8')
            feed_path = root / 'release/update-manifest.json'
            (root / 'plugin/update-config.json').write_text(json.dumps({'repositoryUrl': 'https://github.com/test-owner/test-plugin'}), encoding='utf8')
            feed_path.write_text(json.dumps({'published': False, 'releaseUrl': 'https://github.com/test-owner/test-plugin/releases/tag/v1.9.0'}), encoding='utf8')
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['set_version.py', '1.10.0']):
                module.main()
            self.assertEqual(json.loads(feed_path.read_text())['latestVersion'], '1.10.0')
            self.assertEqual(json.loads(feed_path.read_text())['releaseUrl'], 'https://github.com/test-owner/test-plugin/releases/tag/v1.10.0')
            self.assertEqual(json.loads((root / 'package.json').read_text())['version'], '1.10.0')
            before = (root / 'plugin/manifest.json').read_bytes()
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['set_version.py', '01.10.0']):
                with self.assertRaises(SystemExit):
                    module.main()
            self.assertEqual((root / 'plugin/manifest.json').read_bytes(), before)
            feed_path.write_text(json.dumps({'published': True}), encoding='utf8')
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['set_version.py', '1.11.0']):
                with self.assertRaises(SystemExit):
                    module.main()
            self.assertEqual((root / 'plugin/manifest.json').read_bytes(), before)
