"""Stdlib-only launcher. Reuse installed Python, isolate the two PDF dependencies.

The one-time venv/pip step never calls an OCR service and never receives API keys.
"""
import argparse
import json
import os
import struct
import subprocess
import sys
import time
from pathlib import Path

PINS = ['PyMuPDF==1.26.7','httpx==0.28.1']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data',required=True)
    parser.add_argument('--connection',required=True)
    args = parser.parse_args()
    root = Path(args.data).resolve()
    root.mkdir(parents=True,exist_ok=True)
    state = root/'setup.json'
    def report(stage,message):
        tmp = root/'setup.tmp'
        tmp.write_text(json.dumps(dict(stage=stage,message=message),ensure_ascii=False),encoding='utf8')
        os.replace(tmp,state)
    flags = subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
    try:
        if sys.version_info < (3,10) or struct.calcsize('P')!=8:
            raise RuntimeError('需要 Python 3.10 或更高版本（64 位），请在设置中选择正确的 Python')
        env = root/'python-env'
        binary = env/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        # Separate log contains only local setup/pip output; never credentials.
        with open(root/'setup.log','w',encoding='utf8') as log:
            if not binary.exists():
                report('environment','首次准备：正在用现有 Python 创建插件独立环境')
                subprocess.run([sys.executable,'-m','venv',str(env)],stdout=log,stderr=log,
                               check=True,creationflags=flags)
            check = 'import importlib.metadata as m; assert m.version("PyMuPDF")=="1.26.7"; assert m.version("httpx")=="0.28.1"'
            result = subprocess.run([str(binary),'-c',check],stdout=log,stderr=log,creationflags=flags)
            if result.returncode:
                report('dependencies','首次准备：正在安装 PyMuPDF 和 HTTP 客户端；不下载 OCR 模型')
                subprocess.run([str(binary),'-m','pip','install','--disable-pip-version-check',*PINS],
                    stdout=log,stderr=log,check=True,creationflags=flags)
            report('starting','依赖已就绪，正在启动本地后台服务')
            worker = binary.with_name('pythonw.exe') if os.name=='nt' else binary
            process = subprocess.Popen([str(worker),str(Path(__file__).with_name('run.py')),'serve',
                '--data',str(root),'--connection',args.connection],stdout=log,stderr=log,creationflags=flags)
            for _ in range(120):
                if Path(args.connection).exists():
                    report('ready','本地服务已就绪')
                    return
                if process.poll() is not None:
                    raise RuntimeError('辅助服务启动失败，请查看任务目录 setup.log')
                time.sleep(.25)
            raise RuntimeError('辅助服务启动超时，请查看任务目录 setup.log')
    except Exception as exc:
        report('error',str(exc)+'；请查看 '+str(root/'setup.log'))


if __name__=='__main__':
    main()
