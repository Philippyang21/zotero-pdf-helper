"""Local HTTP integration smoke test. No credentials or OCR endpoints involved."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from test_repair import fixture


class ServiceTests(unittest.TestCase):
    def test_authenticated_loopback_worker_merge_restore_and_single_instance(self):
        scratch=Path.cwd()/'work'/'test-temp'
        scratch.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as folder:
            root=Path(folder)
            source,raw=fixture(root)
            data=root/'service'
            descriptor=root/'connection.json'
            run=Path(__file__).resolve().parents[1]/'helper'/'run.py'
            command=[sys.executable,str(run),'serve','--data',str(data),'--connection',str(descriptor)]
            flags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
            process=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
            try:
                deadline=time.monotonic()+10
                while not descriptor.exists() and time.monotonic()<deadline:
                    self.assertIsNone(process.poll(),'worker exited before startup')
                    time.sleep(.05)
                info=json.loads(descriptor.read_text(encoding='utf8'))
                base='http://127.0.0.1:'+str(info['port'])
                def request(path,body=None,auth=True,extra=None):
                    headers={'Content-Type':'application/json'}
                    if auth:
                        headers['Authorization']='Bearer '+info['token']
                    headers.update(extra or {})
                    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
                    with urllib.request.urlopen(req,timeout=10) as response:
                        return json.load(response)
                self.assertTrue(request('/health')['ok'])
                for extra,auth in [({},False),({'Origin':'https://example.test'},True),({'Host':'evil.test'},True)]:
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        request('/health',auth=auth,extra=extra)
                    self.assertEqual(caught.exception.code,403)
                # A second worker must not rewrite the connection descriptor or own the queue.
                other=subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5,creationflags=flags)
                self.assertEqual(other.returncode,0)
                self.assertEqual(json.loads(descriptor.read_text(encoding='utf8')),info)
                request('/configure',{'token':'','backupDir':str(root/'backups')})
                job=request('/jobs',{'mode':'merge','pdf':str(source),'md':str(root/'scan.md'),'json':str(root/'scan.json')})
                deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    snapshot=request('/jobs')
                    current=snapshot['jobs'][0]
                    if current['state']=='ready':
                        break
                    self.assertNotIn(current['state'],['failed','paused'])
                    time.sleep(.05)
                self.assertEqual(current['state'],'ready')
                self.assertEqual(snapshot['usage'],{})
                self.assertEqual(request('/jobs/'+job['id']+'/commit',{})['state'],'committed')
                self.assertTrue(request('/restore',{'pdf':str(source)})['restored'])
                self.assertEqual(request('/jobs')['usage'],{})
                request('/shutdown',{})
                self.assertEqual(process.wait(timeout=5),0)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)


if __name__=='__main__':
    unittest.main(verbosity=2)
