"""Conservative copyright-page metadata extraction for Chinese books.

This module only proposes values.  Zotero-side code presents them to the user
and fills empty fields after confirmation.
"""
import json
import re
from pathlib import Path

import pymupdf as fitz


MARKERS = {
    '图书在版编目': 6, 'CIP': 5, 'ISBN': 4, '出版发行': 4,
    '出版社': 3, '版次': 3, '印刷': 2, '责任编辑': 1,
    '书名': 2, '著者': 2, '出版地': 2, '版权': 2,
}
NEGATIVE = {'目录': 3, '目 录': 3, 'CONTENTS': 3}
ROLE_SUFFIX = re.compile(r'(?:著|编著|主编|编|译|校注|撰)$')
YEAR = re.compile(r'(?<!\d)((?:18|19|20|21)\d{2})(?:\s*年)?(?!\d)')
NUMBER = '[零〇一二三四五六七八九十百千万两0-9]+'


def _integer(value):
    value = re.sub(r'[^零〇一二三四五六七八九十两0-9]', '', str(value))
    if value.isdigit():
        return value
    digits = {'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
              '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
    if '十' in value:
        left, right = value.split('十', 1)
        number = (digits.get(left, 1) * 10) + digits.get(right, 0)
        return str(number)
    return str(digits[value]) if value in digits else value


def _clean(value):
    value = re.sub(r'<[^>]+>', ' ', str(value or ''))
    value = value.replace('\u3000', ' ').replace('\xa0', ' ')
    return re.sub(r'[ \t]+', ' ', value).strip(' \t\r\n|')


def _json_pages(path):
    """Read text from supported PaddleOCR/canonical JSON without requiring boxes."""
    raw = json.loads(Path(path).read_text(encoding='utf8'))
    if isinstance(raw, dict) and raw.get('schema') == 'zotero-paddleocr/1':
        entries = raw.get('pages', [])
        return [[_clean(line.get('text')) for line in page.get('lines', [])
                 if _clean(line.get('text'))] for page in entries]
    roots = raw if isinstance(raw, list) else [raw]
    entries = []
    for root in roots:
        if not isinstance(root, dict):
            continue
        result = root.get('result', root)
        if isinstance(result, dict) and 'layoutParsingResults' in result:
            entries.extend(result.get('layoutParsingResults') or [])
        elif isinstance(result, dict):
            entries.append(result.get('res', result))
    pages = []
    for entry in entries:
        if not isinstance(entry, dict):
            pages.append([])
            continue
        page = entry.get('prunedResult', entry)
        ocr = page.get('overall_ocr_res', {}) if isinstance(page, dict) else {}
        texts = ocr.get('rec_texts') or page.get('rec_texts') or []
        if not texts:
            blocks = page.get('parsing_res_list') or []
            texts = [block.get('block_content', '') for block in blocks
                     if block.get('block_label') not in ('image', 'chart', 'seal')]
        if not texts:
            markdown = entry.get('markdown') or page.get('markdown') or {}
            text = markdown.get('text', '') if isinstance(markdown, dict) else markdown
            texts = str(text).splitlines()
        pages.append([_clean(text) for text in texts if _clean(text)])
    return pages


def _pdf_pages(path, limit):
    with fitz.open(path) as document:
        return [[_clean(line) for line in document[index].get_text('text').splitlines()
                 if _clean(line)] for index in range(min(limit, len(document)))]


def _page_score(lines):
    text = '\n'.join(lines)
    score = sum(weight for marker, weight in MARKERS.items() if marker.lower() in text.lower())
    score -= sum(weight for marker, weight in NEGATIVE.items() if marker.lower() in text.lower())
    if re.search(r'(?:--?|—{1,2})\s*[^:：，,。]{1,16}\s*[:：]\s*[^，,。]{2,40}(?:出版社|出版公司|书局)', text):
        score += 5
    if re.search(r'第\s*'+NUMBER+r'\s*版', text):
        score += 2
    return score


def _label(lines, labels):
    names = '|'.join(map(re.escape, labels))
    pattern = re.compile(r'^\s*(?:'+names+r')\s*[:：]\s*(.+?)\s*$')
    for line in lines:
        match = pattern.search(line)
        if match:
            return _clean(match.group(1))
    return ''


def _strip_title(value):
    value = re.sub(r'^\s*(?:书名|题名与责任者|题名)\s*[:：]?\s*', '', value)
    value = re.split(r'\s*/\s*', value, maxsplit=1)[0]
    value = re.sub(r'\s*[。．.]\s*$', '', value)
    return _clean(value)


def _authors(value):
    value = re.sub(r'^\s*(?:作者|著者|责任者)\s*[:：]?\s*', '', value)
    value = re.split(r'(?:\.\s*--|．\s*—|—{2}|--)', value, maxsplit=1)[0]
    result = []
    for name in re.split(r'[、,，;；]|\s+(?:and|与|和)\s+', value):
        name = re.sub(r'\[[^]]+\]|\([^)]*\)', '', name).strip()
        name = re.sub(r'^(?:\[?\w+\]?\s*)+', '', name) if re.match(r'^\[[A-Za-z]+\]', name) else name
        name = re.sub(r'(?:等)?'+ROLE_SUFFIX.pattern, '', name).strip(' /。．.')
        if 1 < len(name) <= 40 and not any(word in name for word in ('责任编辑', '装帧', '校对', '印刷', '发行')):
            result.append(name)
    return list(dict.fromkeys(result))


def _structured_cip(lines):
    """Parse the common `title / author. -- place : publisher, year.` CIP form."""
    joined = ' '.join(lines)
    windows = [' '.join(lines[index:index + size]) for size in (2, 3, 4)
               for index in range(max(0, len(lines) - size + 1))]
    candidates = list(lines) + windows + [joined]
    for value in candidates:
        # OCR often splits publisher names between lines; joining Chinese words is
        # safe here because the expression is only used for a structured CIP row.
        value = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', value)
        if '/' not in value or not re.search(r'(?:--|—{1,2})', value):
            continue
        match = re.search(
            r'(?P<title>[^/]{2,100})\s*/\s*(?P<author>.+?)\s*[。．.]?\s*(?:--|—{1,2})\s*'
            r'(?P<place>[^:：，,。]{1,24})\s*[:：]\s*'
            r'(?P<publisher>[^，,。]{2,60}?(?:出版社|出版公司|书局|书社|出版中心))'
            r'\s*[,，]\s*(?P<year>(?:18|19|20|21)\d{2})', value)
        if match:
            return {key: _clean(text) for key, text in match.groupdict().items()}
    return {}


def _parse(lines):
    text = '\n'.join(lines)
    cip = _structured_cip(lines)
    result = {}
    title = _label(lines, ('书名', '题名')) or cip.get('title', '')
    if title:
        title = _strip_title(title)
        if 1 < len(title) <= 150 and '图书在版编目' not in title:
            result['title'] = title

    author_text = _label(lines, ('作者', '著者', '责任者')) or cip.get('author', '')
    author_list = _authors(author_text) if author_text else []
    if author_list:
        result['authors'] = author_list

    volume = _label(lines, ('卷次', '册次'))
    if not volume:
        match = re.search(r'(第\s*'+NUMBER+r'\s*(?:卷|册)|(?:上|中|下)\s*册)', result.get('title', '') or text[:500])
        volume = match.group(1) if match else ''
    if volume:
        result['volume'] = re.sub(r'\s+', '', volume)

    total = _label(lines, ('总卷数', '总册数'))
    if not total:
        match = re.search(r'全\s*('+NUMBER+r')\s*(?:卷|册)', text)
        total = match.group(1) if match else ''
    if total:
        result['numberOfVolumes'] = _integer(total)

    edition = _label(lines, ('版次', '版本'))
    if not edition:
        match = re.search(r'(第\s*'+NUMBER+r'\s*版)', text)
        edition = match.group(1) if match else ''
    if edition:
        result['edition'] = re.sub(r'\s+', '', edition).strip('，,。；;')

    publisher = _label(lines, ('出版社', '出版者', '出版发行')) or cip.get('publisher', '')
    if not publisher:
        match = re.search(r'([\u3400-\u9fffA-Za-z0-9·（）()]{2,40}(?:出版社|出版公司|书局|书社|出版中心))', text)
        publisher = match.group(1) if match else ''
    if publisher:
        result['publisher'] = _clean(publisher).strip('，,。；;')

    place = _label(lines, ('出版地', '出版地点')) or cip.get('place', '')
    if place:
        place = re.sub(r'^(?:中国)?', '', _clean(place)).strip('，,。；;')
        if 1 < len(place) <= 30:
            result['place'] = place

    year = cip.get('year', '')
    if not year:
        preferred = [line for line in lines if any(key in line for key in ('版', '出版', '版权'))]
        matches = [m.group(1) for line in preferred for m in YEAR.finditer(line)]
        if not matches:
            matches = [m.group(1) for m in YEAR.finditer(text)]
        year = matches[0] if matches else ''
    if year:
        result['date'] = year
    return result


def extract(path, json_path=None, limit=40):
    """Return a proposed metadata dict and page evidence; never modifies files."""
    pdf_pages = _pdf_pages(path, limit)
    json_pages = _json_pages(json_path)[:limit] if json_path else []
    count = max(len(pdf_pages), len(json_pages))
    candidates = []
    for index in range(count):
        pdf_lines = pdf_pages[index] if index < len(pdf_pages) else []
        ocr_lines = json_pages[index] if index < len(json_pages) else []
        # Prefer OCR when the PDF page has no useful text; otherwise retain both
        # sources because a newly repaired PDF and JSON can differ slightly.
        lines = list(dict.fromkeys(pdf_lines + ocr_lines))
        candidates.append((_page_score(lines), index, lines,
                           'PDF 文字层和 OCR JSON' if pdf_lines and ocr_lines else
                           'OCR JSON' if ocr_lines else 'PDF 文字层'))
    if not candidates or not any(lines for _, _, lines, _ in candidates):
        raise ValueError('PDF 没有可读取的文字，且未找到可复用的 OCR JSON；请先完成 OCR 或合并已有结果')
    score, index, lines, source = max(candidates, key=lambda row: row[0])
    if score < 4:
        raise ValueError('前 40 页中没有找到可信的版权页；未修改文献条目')
    fields = _parse(lines)
    if not fields:
        raise ValueError('找到了疑似版权页，但没有提取出可安全填写的字段；未修改文献条目')
    evidence = [line[:160] for line in lines if any(marker.lower() in line.lower() for marker in MARKERS)][:5]
    return {'pageIndex': index, 'pageNumber': index + 1, 'score': score,
            'source': source, 'fields': fields, 'evidence': evidence}
