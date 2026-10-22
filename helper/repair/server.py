"""Authenticated loopback service; no browser access, CORS, or credential logging."""
import hmac
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from . import __version__
from .engine import Engine
from .files import atomic_json
from .pdf import inspect
from .copyright import extract as extract_copyright


def serve(data, connection):
    root = Path(data).resolve()
    root.mkdir(parents=True,exist_ok=True)
    # One owner per profile prevents duplicate workers from replaying the same queue.
    instance_lock = open(root/'worker.lock','a+b')
    instance_lock.seek(0)
    if os.name=='nt':
        import msvcrt
        instance_lock.seek(0,os.SEEK_END)
        if instance_lock.tell()==0:
            instance_lock.write(b'0')
            instance_lock.flush()
        instance_lock.seek(0)
        try:
            msvcrt.locking(instance_lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:
            instance_lock.close()
            return
    else:
        import fcntl
        try:
            fcntl.flock(instance_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            instance_lock.close()
            return
    try:
        os.chmod(root,0o700)
    except OSError:
        pass
    engine = Engine(root)
    token = secrets.token_urlsafe(32)
    last_request = [time.monotonic()]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, value, status=200):
            payload = json.dumps(value,ensure_ascii=False,allow_nan=False).encode('utf8')
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError,ConnectionResetError):
                pass

        def authorized(self):
            expected_host = '127.0.0.1:'+str(self.server.server_port)
            auth = self.headers.get('Authorization','')
            if (self.headers.get('Host')!=expected_host or self.headers.get('Origin') or
                not hmac.compare_digest(auth,'Bearer '+token)):
                self.reply({'error':'未授权的本地请求'},403)
                return False
            last_request[0] = time.monotonic()
            return True

        def do_GET(self):
            if not self.authorized():
                return
            if self.path=='/health':
                return self.reply({'ok':True,'version':__version__})
            if self.path=='/jobs':
                return self.reply(engine.snapshot())
            self.reply({'error':'路径不存在'},404)

        def do_POST(self):
            if not self.authorized():
                return
            try:
                size = int(self.headers.get('Content-Length','0'))
                if size < 0 or size > 1024*1024:
                    return self.reply({'error':'请求过大'},413)
                values = json.loads(self.rfile.read(size) or b'{}')
                if not isinstance(values,dict):
                    raise ValueError('请求必须为对象')
                if self.path=='/configure':
                    result = engine.configure(values)
                elif self.path=='/inspect':
                    result = inspect(values['pdf'])
                elif self.path=='/metadata/copyright':
                    result = extract_copyright(values['pdf'], values.get('json'))
                elif self.path=='/jobs':
                    result = engine.create(values)
                elif self.path=='/restore':
                    result = engine.restore(values['pdf'])
                elif self.path=='/cache/clear':
                    result = engine.clear_cache()
                elif self.path=='/shutdown':
                    result = {'stopping':True}
                    threading.Thread(target=self.server.shutdown,daemon=True).start()
                else:
                    parts = self.path.strip('/').split('/')
                    if len(parts)!=3 or parts[0]!='jobs':
                        return self.reply({'error':'路径不存在'},404)
                    ident,action = parts[1:]
                    if action=='resume':
                        result = engine.resume(ident,values.get('remoteIDs'))
                    elif action=='cancel':
                        result = engine.cancel(ident)
                    elif action=='commit':
                        result = engine.commit(ident,values.get('retain',False))
                    elif action=='ack':
                        result = engine.acknowledge(ident,values.get('indexed',True))
                    else:
                        return self.reply({'error':'操作不存在'},404)
                self.reply(result)
            except (ValueError,KeyError,OSError) as exc:
                self.reply({'error':str(exc)[:350]},400)
            except Exception:
                self.reply({'error':'本地处理异常；任务记录已保留'},500)

    server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server.daemon_threads = True
    descriptor = dict(port=server.server_port,token=token,pid=os.getpid(),version=__version__)
    atomic_json(connection,descriptor)
    try:
        os.chmod(connection,0o600)
    except OSError:
        pass

    def idle_watch():
        while not engine.stopping:
            time.sleep(10)
            if time.monotonic()-last_request[0] > 900 and not engine.running:
                server.shutdown()
                return
    threading.Thread(target=idle_watch,daemon=True).start()
    try:
        server.serve_forever(poll_interval=.5)
    finally:
        engine.close()
        server.server_close()
        try:
            Path(connection).unlink(missing_ok=True)
        except OSError:
            pass
        instance_lock.close()
