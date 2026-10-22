"""Official /api/v2/ocr/jobs protocol, checked against upstream _http/_core/_poller.

POST is never retried here. GETs may be resumed using the saved job or batch ID.
"""
import json
from urllib.parse import quote, urlparse
import httpx

BASE_URL = 'https://paddleocr.aistudio-app.com'
MODELS = ['PP-StructureV3', 'PaddleOCR-VL', 'PaddleOCR-VL-1.5', 'PaddleOCR-VL-1.6']
OPTIONS = dict(useDocOrientationClassify=False, useDocUnwarping=False,
               useChartRecognition=False, visualize=False)


class RemoteError(Exception):
    def __init__(self, status, code=0):
        self.status, self.code = status, code
        super().__init__(f'官方 API 状态 {status}，错误码 {code}；结果保留，请在任务窗口恢复')


class OfficialAPI:
    def __init__(self, base_url, token, transport=None):
        parsed = urlparse(base_url)
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('官方服务或代理地址必须使用 HTTPS，不能含密钥/查询参数')
        self.base = base_url.rstrip('/')
        self.token = token
        self.client = httpx.Client(timeout=httpx.Timeout(300, connect=30), follow_redirects=False,
                                   transport=transport)

    def close(self):
        self.client.close()

    def _data(self, response):
        if response.status_code >= 300:
            raise RemoteError(response.status_code)
        try:
            value = response.json()
            if value.get('code', 0) not in (0, None):
                raise RemoteError(response.status_code, value['code'])
            if not isinstance(value.get('data'), dict):
                raise ValueError('官方 API 响应缺少 data 对象')
            return value['data']
        except (TypeError, KeyError, json.JSONDecodeError) as e:
            raise ValueError('官方 API 响应格式错误') from e

    def submit(self, path, model, batch_id, options):
        with open(path, 'rb') as file:
            response = self.client.post(self.base+'/api/v2/ocr/jobs',
                headers={'Authorization':'Bearer '+self.token, 'Client-Platform':'Zotero-PDF-Repair'},
                data={'model':model, 'batchId':batch_id, 'optionalPayload':json.dumps(options)},
                files={'file':(path.name, file, 'application/pdf')})
        data = self._data(response)
        if not isinstance(data.get('jobId'), str) or not data['jobId']:
            raise ValueError('提交响应缺少 jobId；只能查询原批次，禁止重交')
        return data['jobId']

    def status(self, job_id):
        return self._data(self.client.get(self.base+'/api/v2/ocr/jobs/'+quote(job_id, safe=''),
                         headers={'Authorization':'Bearer '+self.token}))

    def batch(self, batch_id):
        data = self._data(self.client.get(self.base+'/api/v2/ocr/jobs/batch/'+quote(batch_id, safe=''),
                         headers={'Authorization':'Bearer '+self.token}))
        if not isinstance(data.get('extractResult'), list):
            raise ValueError('批次响应缺少 extractResult')
        return data['extractResult']

    def results(self, status):
        url = status.get('resultUrl', {}).get('jsonUrl')
        if not isinstance(url, str) or urlparse(url).scheme != 'https':
            raise ValueError('完成任务没有有效的 HTTPS JSONL 下载地址')
        # Do not forward the API Authorization header to object storage.
        with self.client.stream('GET', url, follow_redirects=True) as response:
            response.raise_for_status()
            return [json.loads(line) for line in response.iter_lines() if line.strip()]


def collect(records):
    pages = []
    for record in records:
        result = record.get('result', {})
        group = result.get('layoutParsingResults')
        if not isinstance(group, list):
            raise ValueError('JSONL 缺少 layoutParsingResults；原始响应已保存')
        pages.extend(group)
    if not pages:
        raise ValueError('官方服务返回空页面列表')
    markdown = '\n\n'.join(page.get('markdown', {}).get('text', '') for page in pages)
    if not markdown.strip():
        raise ValueError('没有返回 Markdown；保留 JSON，请检查模型输出')
    return pages, markdown
