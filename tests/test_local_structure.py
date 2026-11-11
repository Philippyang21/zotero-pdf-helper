"""Local backend tests; the release test suite does not install Paddle or download weights."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from test_repair import Engine, fixture, digest
from repair import local_structure


class LocalStructureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pdf, self.raw = fixture(self.root)
        self.engine = Engine(self.root/'jobs', api_factory=self.forbid_cloud)
        self.addCleanup(self.engine.close)
        self.values = dict(pdf=str(self.pdf), mode='local', localPython=sys.executable)

    def forbid_cloud(self, *args):
        self.fail('Local job attempted a cloud request')

    def finish(self, jid):
        for _ in range(200):
            job = self.engine.snapshot()['jobs']
            current = next(j for j in job if j['id']==jid)
            if current['state'] in ('ready','failed','cancelled','paused'):
                return current
            time.sleep(.05)
        self.fail('timeout waiting for local job')

    def test_failed_model_does_not_upload_replace_or_consume_quota(self):
        before = digest(self.pdf)
        with patch.object(self.engine.model_session,'recognize',side_effect=ValueError('model unavailable')):
            jid = self.engine.create(self.values)['id']
            self.assertEqual(self.finish(jid)['state'],'failed')
        self.assertEqual(digest(self.pdf),before)
        self.assertFalse(self.engine.remote_paused)
        self.assertEqual(self.engine.snapshot()['usage'],{})

    def test_local_and_cloud_jobs_are_separate_and_only_cloud_needs_token(self):
        def fake_model(config, directory, pages, cancel, progress):
            (directory/'result.json').write_text(json.dumps(self.raw),encoding='utf8')
            (directory/'result.md').write_text('fixture',encoding='utf8')
        cloud = self.engine.create(dict(pdf=str(self.pdf),mode='ocr'))
        self.assertEqual(cloud['state'],'paused')
        with patch.object(self.engine.model_session,'recognize',side_effect=fake_model) as infer:
            local = self.engine.create(self.values)
            self.assertNotEqual(local['id'],cloud['id'])
            self.assertEqual(self.finish(local['id'])['state'],'ready')
            self.assertEqual(self.engine.create(self.values)['id'],local['id'])
            self.assertEqual(infer.call_count,1)

    def test_resolves_deployment_or_interpreter_and_rejects_missing_paths(self):
        env = self.root/'OCR 环境' / '.venv'
        binary = env / ('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        binary.parent.mkdir(parents=True)
        binary.touch()
        cache = env.parent/'models'
        (cache/'official_models').mkdir(parents=True)
        for location in [env.parent,env,binary]:
            config = local_structure.settings(dict(localPython=str(location)))
            self.assertEqual(config['python'],str(binary))
            self.assertEqual(config['cache'],str(cache))
        for extra in [dict(localCache=str(cache/'missing')),dict(localConfig='relative.yml'),dict(localDevice='invalid')]:
            with self.assertRaises(ValueError):
                local_structure.settings(dict(self.values,**extra))
