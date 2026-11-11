"""Run the local PP-StructureV3 backend in its own Python environment."""
import json
import os
import re
import subprocess
import tempfile
import time
import threading
import uuid
from pathlib import Path

from .files import read_json


def settings(values):
    def path(key):
        value = str(values.get(key) or '').strip().strip('"')
        if not value:
            return None
        p = Path(value).expanduser()
        if not p.is_absolute():
            raise ValueError('本地模型设置需要完整路径')
        return p
    location = path('localPython')
    if not location:
        raise ValueError('请选择已安装 PaddleOCR 的 Python 或部署目录')
    envroot = location
    if location.is_dir():
        candidates = ['python.exe','Scripts/python.exe','.venv/Scripts/python.exe','venv/Scripts/python.exe'] if os.name == 'nt' else [
            'bin/python','bin/python3','.venv/bin/python','.venv/bin/python3','venv/bin/python']
        binary = next((location / p for p in candidates if (location / p).is_file()), None)
    else:
        binary = location
        envroot = location.parent
        if envroot.name.lower() in ('scripts','bin'):
            envroot = envroot.parent
    if not binary or not binary.is_file() or not re.fullmatch(r'python(?:\d+(?:\.\d+)*)?(?:\.exe)?', binary.name, re.I):
        raise ValueError('找不到 Python。请在部署环境中运行 python -c "import sys; print(sys.executable)" 并填写输出的完整路径')
    cache = path('localCache')
    if not cache:
        roots = [envroot, envroot.parent] if envroot.name in ('.venv','venv') else [envroot]
        cache = next((p/'models' for p in roots if (p/'models/official_models').is_dir()), None)
    if cache and not cache.is_dir():
        raise ValueError('指定的 PaddleX 模型缓存目录不存在')
    config = path('localConfig')
    if config and (not config.is_file() or config.suffix.lower() not in ('.yml','.yaml')):
        raise ValueError('请选择有效的 PP-StructureV3 YAML 配置文件')
    device = values.get('localDevice','auto')
    if device not in ('auto','cpu','gpu:0'):
        raise ValueError('不支持的运行设备')
    # Keep the venv interpreter symlink: resolving it can select the system environment.
    return dict(python=str(binary), cache=str(cache or ''), config=str(config or ''), device=device,
                formula=values.get('localFormula', True) is True)


def launch(config, verb, directory, log):
    env = os.environ.copy()
    if config['device']=='cpu':
        env['CUDA_VISIBLE_DEVICES'] = '-1'
    if config['cache']:
        env['PADDLE_PDX_CACHE_HOME'] = config['cache']
    env['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
    env.setdefault('FLAGS_allocator_strategy', 'auto_growth')
    binary = Path(config['python'])
    if os.name == 'nt' and (binary.parent/'Library/bin').is_dir():  # activated conda DLL search path
        env['PATH'] = os.pathsep.join([str(binary.parent), str(binary.parent/'Library/bin'), env.get('PATH','')])
    worker = Path(__file__).resolve().parents[1]/'structure_worker.py'
    return subprocess.Popen([str(binary), '-B', '-X', 'faulthandler', '-X', 'utf8', str(worker), verb, config['device'], config['config'], 'yes' if config.get('formula',True) else 'no'],
                            cwd=directory, env=env, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def diagnostic(log, code=None):
    log.seek(max(0, log.seek(0, 2)-16384))
    lines = log.read().decode('utf8','replace').splitlines()
    message = next((s.partition('PDF_HELPER_ERROR ')[2] for s in reversed(lines) if s.startswith('PDF_HELPER_ERROR ')), '')
    return ValueError('本地 PP-StructureV3 未能运行：'+(message or f'模型进程退出（{code}）。请检查 Python 环境、设备和内存。'))


def probe(values):
    config = settings(values)
    with tempfile.TemporaryFile() as log:
        process = launch(config, 'check', None, log)
        try:
            process.wait(timeout=90)
        except subprocess.TimeoutExpired:
            raise ValueError('导入本地 PaddleOCR 超时，请检查此 Python 环境')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdin.close()
        if process.returncode:
            raise diagnostic(log,process.returncode)
        log.seek(0)
        for line in log:
            if line.startswith(b'PDF_HELPER_OK '):
                return json.loads(line.split(b' ',1)[1])
        raise diagnostic(log,process.returncode)


class ModelSession:
    """Own one model process. The scheduler admits one local job at a time."""
    def __init__(self, root):
        self.root = root
        self.lock = threading.RLock()
        self.process = self.log = self.config = self.retain = None
        self.busy = False

    def configure(self, retain):
        with self.lock:
            self.retain = retain
            if not self.busy and self.config != retain:
                self._release()

    def _release(self):
        if self.process:
            if self.process.poll() is None:
                self.process.kill()
            self.process.wait()
            self.process.stdin.close()
        if self.log:
            self.log.close()
        self.process = self.log = self.config = None

    def recognize(self, config, directory, pages, cancel, progress):
        parts = directory/'local-pages'
        parts.mkdir(exist_ok=True)
        attempt = uuid.uuid4().hex
        status = directory/'local-status.json'
        success = False
        try:
            with self.lock:
                self.busy = True
                if self.config != config or not self.process or self.process.poll() is not None:
                    self._release()
                    self.log = (self.root/'local-model.log').open('w+b')
                    self.process = launch(config, 'serve', self.root, self.log)
                    self.config = config
                data = dict(directory=str(directory.resolve()),attempt=attempt)
                self.process.stdin.write(json.dumps(data).encode('utf8')+b'\n')
                self.process.stdin.flush()
            last = None
            completed = 0
            while True:
                cancel()
                if self.process.poll() is not None:
                    raise diagnostic(self.log,self.process.returncode)
                info = read_json(status) if status.exists() else {}
                if info.get('attempt')==attempt:
                    while completed < pages and (parts/f'{completed}.json').is_file():
                        completed += 1
                    stage = info['stage']
                    if (stage,completed) != last:
                        progress('localLoading' if stage=='loading' else 'local', completed, pages)
                        last = (stage,completed)
                    if stage=='complete':
                        break
                time.sleep(.3)
            success = True
        finally:
            with self.lock:
                self.busy = False
                if not success or self.config != self.retain:
                    self._release()
        progress('localSaving',pages,pages)
        combine(directory, pages, cancel)
        return dict(device=info['device'], reused=info['reused'], loadSeconds=info['loadSeconds'])


def combine(directory, pages, cancel):
    parts = directory/'local-pages'
    # Publish the pair only after the worker successfully processed the whole source.
    raw_tmp, md_tmp = directory/'local-result.tmp', directory/'local-md.tmp'
    with raw_tmp.open('w',encoding='utf8') as raw, md_tmp.open('w',encoding='utf8') as md:
        raw.write('[')
        for index in range(pages):
            cancel()
            record = read_json(parts/f'{index}.json')
            if record['page']['page_index'] != index:
                raise ValueError('本地结果页序不匹配')
            if index:
                raw.write(',')
                md.write('\n\n')
            json.dump(record['page'], raw, ensure_ascii=False)
            md.write(record['markdown'])
        raw.write(']')
    os.replace(md_tmp, directory/'result.md')
    os.replace(raw_tmp, directory/'result.json')
