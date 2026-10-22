import copy
import hashlib
import json
import math
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
import httpx
import pymupdf as fitz
from .api import OfficialAPI, RemoteError, collect, BASE_URL, MODELS, OPTIONS
from .files import atomic_json, read_json, digest, verified_copy, replace_file
from .pdf import inspect, generate, validate, PDF_LOCK
from .schema import normalize

MAX_BYTES = 50_000_000
TARGET_BYTES = 48_000_000
MAX_PAGES = 1000
POLL_TIMEOUT = 1800
POLL_INTERVAL = 3
TERMINAL = {'done', 'cancelled', 'failed'}


class PauseTask(ValueError):
    """A local queue gate; never an invitation to resubmit a remote task."""


def timestamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')


class Engine:
    def __init__(self, root, api_factory=OfficialAPI):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.file_lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='repair')
        self.jobs, self.running, self.api_clients = {}, set(), {}
        self.ocr_locks = {}
        self.cancelled = set()
        self.progress_saved = {}
        self.remote_slots = threading.BoundedSemaphore(2)
        self.activities, self.api_started = {}, {}
        self.api_factory = api_factory
        self.config = dict(concurrency=1, partConcurrency=2, dailyThreshold=20000, autoReplace=True,
                           backupDir=str(self.root/'backups'), sidecars='archive', baseURL=BASE_URL,legacyPDFScale=0)
        self.token = ''
        self.remote_paused = False
        self.stopping = False
        for file in self.root.glob('jobs/*/job.json'):
            job = read_json(file)
            if job['state'] in ('queued','preparing','recognizing','generating','committing'):
                job['recoverable'] = True
                job['state'] = 'paused'
                job['message'] = '进程中断；恢复只查询已提交任务，不自动重交'
            self.jobs[job['id']] = job
        self._recover_commits()

    def save(self, job, **changes):
        with self.lock:
            job.update(changes, updated=timestamp())
            atomic_json(self.directory(job)/'job.json', job)

    def directory(self, job):
        return self.root/'jobs'/job['id']

    def progress(self, job, stage, completed=0, total=0):
        # In-memory counts are live; throttle journal writes for large books.
        with self.lock:
            previous=job.get('progress',{})
            job['progress']=dict(stage=stage,completed=completed,total=total)
            now=time.monotonic()
            if (previous.get('stage')!=stage or completed==total or
                now-self.progress_saved.get(job['id'],0)>=1):
                self.progress_saved[job['id']]=now
                self.save(job)

    def configure(self, values):
        with self.lock:
            allowed = ('concurrency','partConcurrency','dailyThreshold','autoReplace','backupDir','sidecars','baseURL','legacyPDFScale')
            for key in allowed:
                if key in values:
                    self.config[key] = values[key]
            self.config['concurrency'] = max(1, min(2, int(self.config['concurrency'])))
            self.config['partConcurrency'] = max(1, min(2, int(self.config['partConcurrency'])))
            self.config['dailyThreshold'] = max(1,int(self.config['dailyThreshold']))
            scale=float(self.config['legacyPDFScale'])
            if not 0 <= scale <= 8 or not math.isfinite(scale):
                raise ValueError('旧版 PDF 坐标倍率须在 0–8 之间；0 表示不推断')
            self.config['legacyPDFScale']=scale
            if self.config['sidecars'] not in ('archive','hidden','import','link'):
                raise ValueError('不支持的识别结果保存方式')
            if 'token' in values:
                self.token = values['token']
            self.remote_paused = False
            for job in self.jobs.values():
                if job.pop('recoverable',False):
                    self.save(job,state='queued',message='正在自动恢复原任务记录')
        self.schedule()
        return {'configured':bool(self.token), 'settings':self.config}

    def snapshot(self):
        with self.lock:
            today = timestamp()[:10]
            usage, receipts = {}, {}
            for job in self.jobs.values():
                for part in job.get('parts', []):
                    previous = receipts.get(part['batchID'])
                    if previous is None or (part.get('remoteID') and not previous[1].get('remoteID')):
                        receipts[part['batchID']] = (job,part)
            for job,part in receipts.values():
                    if part.get('submitted', '').startswith(today):
                        item = usage.setdefault(job['model'],dict(accepted=0,uncertain=0))
                        if part.get('remoteID'):
                            item['accepted'] += part['end']-part['start']
                        elif part['state'] not in ('new','rejected'):
                            item['uncertain'] += part['end']-part['start']
            jobs = copy.deepcopy(list(self.jobs.values()))
            now = time.monotonic()
            for job in jobs:
                if job['id'] in self.api_started:
                    job['apiSeconds'] = round(job.get('apiSeconds',0)+now-self.api_started[job['id']],3)
                for number,part in enumerate(job.get('parts',[])):
                    active = self.activities.get((job['id'],number))
                    if active:
                        phase,started = active
                        timing = part.setdefault('timing',{})
                        timing[phase] = round(timing.get(phase,0)+now-started,3)
            return dict(jobs=jobs, usage=usage,
                        dailyThreshold=self.config['dailyThreshold'], remotePaused=self.remote_paused,
                        accountQuota=dict(available=False,checked='2026-10-20',
                            message='未接入官方账户用量查询；账户已用与剩余页数未知。',
                            consoleURL='https://aistudio.baidu.com/paddleocr/task'),
                        note='仅本插件本地提交记录；不是账户实时剩余额度。日期按北京时间。')

    def create(self, values):
        mode = values.get('mode')
        if mode not in ('ocr','merge'):
            raise ValueError('不支持的任务模式')
        path = Path(values['pdf']).resolve(strict=True)
        if path.suffix.lower() != '.pdf':
            raise ValueError('请选择 PDF 文件')
        # Inspection/hashing runs in the HTTP request thread, never the Zotero UI thread.
        info = inspect(path)
        model = values.get('model','PP-StructureV3')
        if model not in MODELS:
            raise ValueError('不支持的官方文档解析模型')
        json_path, md_path, sidecar_hash = None, None, ''
        if mode == 'merge':
            json_path = str(Path(values['json']).resolve(strict=True))
            md_path = str(Path(values['md']).resolve(strict=True))
            sidecar_hash = digest(json_path)+digest(md_path)
            normalize(read_json(json_path), info['pages'], Path(md_path).read_text(encoding='utf-8-sig'),
                      pdf_dimensions=info['dimensions'],legacy_scale=self.config['legacyPDFScale'])
        with self.lock:
            for previous in self.jobs.values():
                same_content = info['sha256'] in (previous['sha256'],previous.get('outputHash'))
                if (previous['target']==str(path) and previous['mode']==mode and same_content
                    and previous.get('sidecarHash','')==sidecar_hash and previous['model']==model
                    and previous.get('legacyPDFScale',0)==self.config['legacyPDFScale']
                    and previous['baseURL']==self.config['baseURL']):
                    # An explicit retry resumes this job; never silently submit another POST.
                    if (previous['state'] in ('done','committed') and
                        info['sha256']==previous['sourceHash'] and info['sha256']!=previous.get('outputHash')):
                        self.save(previous,state='queued',restored=False,sha256=info['sha256'],
                                  message='原 PDF 已恢复；复用已有识别结果重新生成')
                        self.schedule()
                    return copy.deepcopy(previous)
            ident = uuid.uuid4().hex
            job = dict(id=ident, mode=mode, target=str(path), sha256=info['sha256'],
                pages=info['pages'], bytes=info['bytes'], model=model, options=OPTIONS.copy(),
                dimensions=info['dimensions'],
                baseURL=self.config['baseURL'], state='preparing', created=timestamp(),
                attachment=values.get('attachment'), parent=values.get('parent'),
                autoReplace=bool(self.config['autoReplace']), backupDir=self.config['backupDir'],
                legacyPDFScale=self.config['legacyPDFScale'],
                sidecars=self.config['sidecars'], sidecarHash=sidecar_hash, parts=[],
                apiSeconds=0, pdfSeconds=0, message='准备后台任务')
            directory = self.directory(job)
            directory.mkdir(parents=True)
            # Preserve a stable source for rendering and for subsequent local regenerations.
            original = next((j for j in reversed(list(self.jobs.values())) if
                j['target']==str(path) and j.get('outputHash')==info['sha256'] and
                (self.directory(j)/'source.pdf').exists()), None)
            source = self.directory(original)/'source.pdf' if original else path
            shutil.copyfile(source, directory/'source.pdf')
            if not original and digest(directory/'source.pdf') != info['sha256']:
                raise ValueError('PDF 在准备阶段发生变化；未提交 OCR')
            job['sourceHash'] = digest(directory/'source.pdf')
            if mode == 'merge':
                shutil.copyfile(json_path,directory/'result.json')
                shutil.copyfile(md_path,directory/'result.md')
            self.jobs[ident] = job
            self.save(job, state='queued', message=f'排队中；预计 {info["pages"]} 页')
        self.schedule()
        return copy.deepcopy(job)

    def schedule(self):
        with self.lock:
            if self.stopping:
                return
            for job in self.jobs.values():
                if len(self.running) >= self.config['concurrency']:
                    break
                if job['id'] in self.running or job['state'] != 'queued':
                    continue
                directory = self.directory(job)
                cache = self.root/'cache'/self._cache_key(job)
                local_results = any((p/'result.json').exists() and (p/'result.md').exists() for p in (directory,cache))
                if job['mode']=='ocr' and not local_results and (self.remote_paused or not self.token):
                    self.save(job,state='paused',message='请配置 API 密钥/解除服务暂停后恢复')
                    continue
                self.running.add(job['id'])
                self.pool.submit(self._run,job)

    def _run(self, job):
        try:
            self.check_cancel(job)
            directory = self.directory(job)
            if job['mode']=='ocr':
                key = self._cache_key(job)
                with self.lock:
                    guard = self.ocr_locks.setdefault(key,threading.Lock())
                with guard:
                    self._ocr(job)
            self.check_cancel(job)
            self.save(job,state='generating',message='本地生成不可见文字层')
            started = time.monotonic()
            result = generate(directory/'source.pdf',read_json(directory/'result.json'),
                (directory/'result.md').read_text(encoding='utf-8-sig'),directory/'searchable.pdf',
                cancelled=lambda:self.stopping or job['id'] in self.cancelled,
                legacy_scale=job.get('legacyPDFScale',0),progress=lambda *args:self.progress(job,*args))
            self.check_cancel(job)
            self.save(job,state='ready',report=result,pdfSeconds=round(time.monotonic()-started,3),
                outputHash=digest(directory/'searchable.pdf'),
                output=str(directory/'searchable.pdf'), json=str(directory/'result.json'),
                md=str(directory/'result.md'),message='检查通过，等待 Zotero 保存结果附件及安全替换')
            self.progress(job,'ready')
        except InterruptedError:
            if self.stopping and job['id'] not in self.cancelled:
                self.save(job,state='paused',recoverable=True,message='Zotero 退出；下次启动恢复原任务及已有结果')
            else:
                self.save(job,state='cancelled',message='已取消本地处理；远端已提交任务可能继续，恢复时仍复用原任务')
        except PauseTask as exc:
            self.save(job,state='paused',message=str(exc))
        except (httpx.HTTPError, RemoteError) as exc:
            with self.lock:
                self.remote_paused = True
            # Never log request URLs, auth headers, signed result URLs or remote message bodies.
            msg = str(exc) if isinstance(exc,RemoteError) else '网络请求中断；仅恢复查询，禁止重复提交'
            self.save(job,state='paused',message=msg)
        except Exception as exc:
            # Locally generated errors contain no credentials. Remote bodies never propagate.
            self.save(job,state='failed',message=str(exc)[:350])
        finally:
            with self.lock:
                self.running.discard(job['id'])
            self.schedule()

    def check_cancel(self, job):
        if self.stopping or job['id'] in self.cancelled:
            raise InterruptedError()

    def _api(self, job):
        key = (job['baseURL'],self.token)
        with self.lock:
            if key not in self.api_clients:
                self.api_clients[key] = self.api_factory(job['baseURL'],self.token)
            return self.api_clients[key]

    def _split(self, job):
        directory = self.directory(job)
        parts = []
        with PDF_LOCK, fitz.open(directory/'source.pdf') as source:
            def render(start,end):
                self.check_cancel(job)
                with fitz.open() as target:
                    target.insert_pdf(source,from_page=start,to_page=end-1)
                    return target.tobytes(deflate=True)
            if job['pages'] <= MAX_PAGES and (directory/'source.pdf').stat().st_size <= MAX_BYTES:
                parts.append(dict(start=0,end=job['pages'],path=str(directory/'source.pdf'),
                                  state='new',batchID='zpr-'+uuid.uuid4().hex))
            else:
                start = 0
                while start < len(source):
                    low, high = start+1, min(len(source),start+MAX_PAGES)
                    best, end = None, start
                    # Fit continuous pages to actual serialized bytes, without changing images.
                    while low <= high:
                        candidate = (low+high)//2
                        data = render(start,candidate)
                        if len(data) <= min(TARGET_BYTES,MAX_BYTES):
                            best,end,low = data,candidate,candidate+1
                        else:
                            high = candidate-1
                    if best is None:
                        best,end = render(start,start+1),start+1
                    if len(best) > MAX_BYTES:
                        raise ValueError(f'第 {start+1} 页本身超过官方本地上传 50 MB 限制；未提交')
                    path = directory/f'part-{start:06d}-{end:06d}.pdf'
                    path.write_bytes(best)
                    parts.append(dict(start=start,end=end,path=str(path),state='new',
                                      batchID='zpr-'+uuid.uuid4().hex))
                    start = end
        self.save(job,parts=parts)

    def _cache_key(self, job):
        value = [job['sourceHash'],job['model'],job['options'],job['baseURL']]
        return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

    def _ocr(self, job):
        directory = self.directory(job)
        cache = self.root/'cache'/self._cache_key(job)
        # Complete MD/JSON always bypasses both submission and status queries.
        for location in (directory,cache):
            if (location/'result.json').exists() and (location/'result.md').exists():
                normalize(read_json(location/'result.json'),job['pages'],(location/'result.md').read_text(encoding='utf8'),
                          pdf_dimensions=job.get('dimensions') or inspect(directory/'source.pdf')['dimensions'],legacy_scale=job.get('legacyPDFScale',0))
                if location != directory:
                    shutil.copyfile(location/'result.json',directory/'result.json')
                    shutil.copyfile(location/'result.md',directory/'result.md')
                self.save(job,reused=True)
                return
        if not job['parts']:
            self.progress(job,'splitting')
            # Duplicate attachments share both successful cache and uncertain receipts.
            # An uncertain POST in another attachment must never cause a second POST.
            with self.lock:
                previous = next((j for j in self.jobs.values() if j['id']!=job['id'] and
                    j['mode']=='ocr' and j.get('parts') and self._cache_key(j)==self._cache_key(job)),None)
                if previous:
                    self.save(job,parts=copy.deepcopy(previous['parts']))
                    for n in range(len(previous['parts'])):
                        existing = self.directory(previous)/f'raw-{n}.json'
                        if existing.exists():
                            shutil.copyfile(existing,directory/f'raw-{n}.json')
            if not job['parts']:
                self._split(job)
        self.save(job,state='recognizing',message='正在处理云端页段；已提交任务与结果持续保存')
        self._remote_progress(job)
        abort = threading.Event()
        # A shared semaphore caps remote work at two across all PDFs. Each PDF can opt for one.
        with self.lock:
            self.api_started[job['id']] = time.monotonic()
        try:
            with ThreadPoolExecutor(max_workers=self.config['partConcurrency'],thread_name_prefix='ocr-part') as pool:
                futures = [pool.submit(self._process_part,job,n,abort) for n in range(len(job['parts']))]
                errors = []
                for future in futures:
                    try:
                        future.result()
                    except Exception as exc:
                        errors.append(exc)
                if errors:
                    raise next((e for e in errors if not isinstance(e,InterruptedError)),errors[0])
        finally:
            with self.lock:
                job['apiSeconds'] += round(time.monotonic()-self.api_started.pop(job['id']),3)
                self.save(job)
        merged, markdowns = [], []
        # Completion order can differ from page order; merge only in original segment order.
        for number,part in enumerate(job['parts']):
            self.check_cancel(job)
            raw_path = directory/f'raw-{number}.json'
            pages,markdown = collect(read_json(raw_path))
            if len(pages) != part['end']-part['start']:
                raise ValueError('远端结果页数与提交页段不一致；保存原始结果，禁止重新识别')
            # Each part is ordered locally; explicitly remap raw page_index to document index.
            for offset,page in enumerate(pages):
                if isinstance(page.get('prunedResult'),dict):
                    page['prunedResult'].pop('page_index',None)
            merged.extend(pages)
            markdowns.append(markdown)
        raw = {'result':{'layoutParsingResults':merged}}
        md = '\n\n'.join(markdowns)
        # Save raw output even when it lacks coordinates. Never fall back to a second model.
        atomic_json(directory/'result.json',raw)
        (directory/'result.md').write_text(md,encoding='utf8')
        normalize(raw,job['pages'],md,pdf_dimensions=job.get('dimensions') or inspect(directory/'source.pdf')['dimensions'],
                  legacy_scale=job.get('legacyPDFScale',0))
        cache.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(directory/'result.json',cache/'result.json')
        shutil.copyfile(directory/'result.md',cache/'result.md')

    def _activity(self, job, number, phase=None):
        with self.lock:
            key = (job['id'],number)
            part = job['parts'][number]
            previous = self.activities.get(key)
            now = time.monotonic()
            if previous:
                old,started = self.activities.pop(key)
                timing = part.setdefault('timing',{})
                timing[old] = round(timing.get(old,0)+now-started,3)
            if phase:
                part['phase'] = phase
                self.activities[key] = (phase,now)
            self.save(job)

    def _remote_progress(self, job):
        with self.lock:
            received = sum(p['end']-p['start'] for p in job['parts'] if p['state']=='done')
            complete = sum((p['end']-p['start']) if p['state']=='done' else
                           (p.get('remoteProgress') or {}).get('completed',0) for p in job['parts'])
            known = received > 0 or any(p.get('remoteProgress') is not None for p in job['parts'])
            self.progress(job,'remote',complete,job['pages'])
            job['progress'].update(resultPages=received,known=known)

    def _remote_status(self, job, number, status):
        with self.lock:
            part = job['parts'][number]
            state = status.get('state')
            part.update(remoteState=state,lastChecked=timestamp(),remoteProgress=None)
            ep = status.get('extractProgress')
            if isinstance(ep,dict):
                try:
                    total,complete = int(str(ep['totalPages'])),int(str(ep['extractedPages']))
                    if total == part['end']-part['start'] and 0 <= complete <= total:
                        part['remoteProgress'] = dict(completed=complete,total=total)
                except (KeyError,TypeError,ValueError):
                    pass
            self._remote_progress(job)
            self.save(job)

    def _process_part(self, job, number, abort):
        part = job['parts'][number]
        raw_path = self.directory(job)/f'raw-{number}.json'
        acquired = False
        def check():
            self.check_cancel(job)
            if abort.is_set():
                raise InterruptedError()
        try:
            check()
            if raw_path.exists():
                with self.lock:
                    part.update(state='done',phase='done')
                    self._remote_progress(job)
                    self.save(job)
                return
            while not acquired:
                check()
                acquired = self.remote_slots.acquire(timeout=.1)
            check()
            api = self._api(job)
            if not part.get('remoteID') and part['state'] not in ('new','rejected'):
                self._activity(job,number,'waiting')
                recovered = api.batch(part['batchID'])
                if len(recovered) != 1 or not recovered[0].get('jobId'):
                    raise PauseTask('提交回执待确认；原批次暂未找到唯一任务。请稍后恢复或填写已有任务 ID，不会重交')
                with self.lock:
                    part.update(remoteID=recovered[0]['jobId'],state='accepted')
                    self.save(job)
            if not part.get('remoteID'):
                with self.lock:
                    check()
                    if self.remote_paused:
                        raise PauseTask('远端服务已暂停；恢复时继续原任务')
                    usage = self.snapshot()['usage'].get(job['model'],{})
                    estimate = usage.get('accepted',0)+usage.get('uncertain',0)+part['end']-part['start']
                    if estimate > self.config['dailyThreshold']:
                        raise PauseTask('达到本地每日页数提醒阈值；请调整阈值或次日恢复。此数字不是账户余额')
                    part.update(state='intent',submitted=timestamp())
                    # Reservation and durable intent are atomic across concurrent workers.
                    self.save(job)
                self._activity(job,number,'uploading')
                try:
                    remote_id = api.submit(Path(part['path']),job['model'],part['batchID'],job['options'])
                except RemoteError as exc:
                    if exc.status in (400,401,403,413,422,429):
                        with self.lock:
                            part['state'] = 'rejected'
                            self.save(job)
                    raise
                # Persist a returned receipt even if a sibling was cancelled during upload.
                with self.lock:
                    part.update(remoteID=remote_id,state='accepted')
                    self.save(job)
            self._activity(job,number,'waiting')
            deadline, interval = time.monotonic()+POLL_TIMEOUT,POLL_INTERVAL
            while True:
                check()
                status = api.status(part['remoteID'])
                self._remote_status(job,number,status)
                state = status.get('state')
                if state == 'done':
                    self._activity(job,number,'downloading')
                    # Downloaded raw output is retained even if later validation fails.
                    atomic_json(raw_path,api.results(status))
                    with self.lock:
                        part.update(state='done',phase='done')
                        self._remote_progress(job)
                        self.save(job)
                    break
                if state == 'failed':
                    raise ValueError(f'第 {number+1} 段云端识别失败；原任务和已生成结果保留，不自动重新识别')
                if state not in ('pending','running'):
                    raise ValueError('官方任务返回未知状态；请保留任务 ID 后恢复')
                self._activity(job,number,state)
                if time.monotonic() > deadline:
                    raise PauseTask('等待超过 30 分钟；点击恢复将继续查询原任务，已下载结果保留')
                until = time.monotonic()+interval
                while time.monotonic() < until:
                    check()
                    abort.wait(min(.1,max(0,until-time.monotonic())))
                interval = min(interval*1.5,10)
        except Exception as exc:
            abort.set()
            if isinstance(exc,(httpx.HTTPError,RemoteError)):
                with self.lock:
                    self.remote_paused = True
            raise
        finally:
            self._activity(job,number)
            if acquired:
                self.remote_slots.release()

    def resume(self, ident, remote_ids=None):
        with self.lock:
            job = self.jobs[ident]
            if ident in self.running:
                return copy.deepcopy(job)
            if job['state'] in ('done','committed','ready','retained'):
                return copy.deepcopy(job)
            if remote_ids:
                for index,value in remote_ids.items():
                    if not isinstance(value,str) or not value.strip() or len(value)>200:
                        raise ValueError('任务 ID 无效')
                    job['parts'][int(index)]['remoteID'] = value.strip()
            self.cancelled.discard(ident)
            self.remote_paused = False
            self.save(job,state='queued',message='恢复原任务/本地结果；不会重交不确定的请求')
        self.schedule()
        return copy.deepcopy(job)

    def cancel(self, ident):
        with self.lock:
            job = self.jobs[ident]
            if job['state'] in ('done','committed','retained'):
                return copy.deepcopy(job)
            self.cancelled.add(ident)
            if ident not in self.running:
                self.save(job,state='cancelled',message='已取消；远端任务 ID 与识别结果保留')
            return copy.deepcopy(job)

    def commit(self, ident, retain=False):
        with self.file_lock:
            job = self.jobs[ident]
            if job['state'] in ('committed','done','retained'):
                return copy.deepcopy(job)
            if job['state'] != 'ready' or ident in self.cancelled:
                raise ValueError('任务尚未通过本地检查或已取消')
            if retain or not job['autoReplace']:
                self.save(job,state='retained',message='已保留可检索 PDF，自动替换已关闭')
                return copy.deepcopy(job)
            directory = self.directory(job)
            self.progress(job,'checking',0,len(job['report']['touched']))
            validate(directory/'searchable.pdf',job['pages'],job['report']['touched'],
                     progress=lambda *args:self.progress(job,*args))
            self.progress(job,'backup')
            if digest(directory/'searchable.pdf') != job['outputHash']:
                raise ValueError('候选 PDF 已被修改；禁止替换')
            if digest(job['target']) != job['sha256']:
                raise ValueError('原附件已更改；禁止替换')
            # Back up the first visual source and the immediately preceding version.
            backup = Path(job['backupDir'])/(job['sourceHash']+'.pdf')
            verified_copy(directory/'source.pdf',backup,job['sourceHash'])
            prior = Path(job['backupDir'])/(job['sha256']+'.pdf')
            verified_copy(job['target'],prior,job['sha256'])
            self.save(job,state='committing',backup=str(backup),priorBackup=str(prior),
                      message='备份已验证，正在原位替换')
            try:
                self.progress(job,'replacing')
                replace_file(directory/'searchable.pdf',job['target'],job['sha256'])
            except Exception:
                self.save(job,state='ready',message='替换失败；原 PDF 保持不变，可关闭阅读器后重试')
                raise
            self.save(job,state='committed',message='PDF 已替换；等待 Zotero 更新同步与索引')
            self.progress(job,'indexing')
            return copy.deepcopy(job)

    def acknowledge(self, ident, indexed=True):
        job = self.jobs[ident]
        if job['state']=='committed':
            self.save(job,state='done',indexPending=not indexed,message='已完成；附件身份保留，原始备份可恢复' if indexed else 'PDF 已替换；Zotero 全文索引待重建，原始备份可恢复')
        return copy.deepcopy(job)

    def _recover_commits(self):
        for job in self.jobs.values():
            if job.get('outputHash') and job.get('backup') and Path(job['target']).exists():
                if digest(job['target'])==job['outputHash'] and job['state'] not in ('done','retained'):
                    self.save(job,state='committed',message='检测到已完成的文件替换；等待 Zotero 恢复元数据')

    def restore(self, target):
        with self.file_lock:
            target = str(Path(target).resolve(strict=True))
            candidates = [j for j in self.jobs.values() if j['target']==target and j.get('backup')]
            if not candidates:
                raise ValueError('没有此附件的原始备份')
            job = candidates[-1]
            current = digest(target)
            if current==job['sourceHash']:
                self.save(job,restored=True,message='原 PDF 已是原始版本；识别结果仍保留')
                return dict(restored=True,alreadyOriginal=True)
            if current not in {j.get('outputHash') for j in candidates}:
                raise ValueError('附件已被其他程序修改；请在备份目录手工恢复，避免覆盖新编辑')
            if digest(job['backup']) != job['sourceHash']:
                raise ValueError('备份校验失败；未恢复')
            verified_copy(target,Path(job['backupDir'])/(current+'.pdf'),current)
            replace_file(job['backup'],target,current)
            self.save(job,restored=True,message='已恢复原始 PDF；识别结果仍保留')
            return dict(restored=True)

    def clear_cache(self):
        with self.lock:
            if self.running:
                raise ValueError('任务运行时不能清理缓存')
            # Cache is derived only. Journal, backups and all raw results are never cleared.
            path = (self.root/'cache').resolve()
            if path.parent != self.root.resolve():
                raise ValueError('缓存目录异常')
            if path.exists():
                shutil.rmtree(path)
            return {'cleared':True}

    def close(self):
        self.stopping = True
        self.pool.shutdown(wait=True,cancel_futures=True)
        for client in self.api_clients.values():
            client.close()
