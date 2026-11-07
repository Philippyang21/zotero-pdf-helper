"""Conservative copyright-page metadata extraction for Chinese books.

This module only proposes values.  Zotero-side code presents them to the user
and fills empty fields after confirmation.
"""
import json
import re
import statistics
from pathlib import Path

import pymupdf as fitz


MARKERS = {
    '图书在版编目': 6, 'CIP': 5, 'ISBN': 4, '出版发行': 4,
    '出版社': 3, '版次': 3, '印刷': 2, '责任编辑': 1,
    '书名': 2, '著者': 2, '出版地': 2, '版权': 2, '著作人': 4,
    '发行所': 4, '中华民国': 4, '初版': 3,
}
NEGATIVE = {'目录': 3, '目 录': 3, 'CONTENTS': 3}
ROLE_SUFFIX = re.compile(r'(?:著|编著|主编|编|译|校注|撰)$')
YEAR = re.compile(r'(?<!\d)((?:18|19|20|21)\d{2})(?:\s*年)?(?!\d)')
NUMBER = '[零〇一二三四五六七八九十百千万两廿卅0-9]+'
TRADITIONAL = str.maketrans(dict(zip(
    '書詩雜話順學資料論劉傑國華發處編輯責權滬臺灣慶與譯總冊價經銷賣號',
    '书诗杂话顺学资料论刘杰国华发处编辑责权沪台湾庆与译总册价经销卖号')))
ROLES = r'编著|主编|编者|编纂|编选|作者|著者|著作人|翻译者|译者|翻译|编|著|撰|译'
EXCLUDED_ROLES = r'责任编辑|责任校对|编辑|校对|装帧|设计|发行人|出版人|印刷|经售'


def _integer(value):
    value = re.sub(r'[^零〇一二三四五六七八九十百千万两廿卅0-9]', '', str(value))
    value = value.replace('廿', '二十').replace('卅', '三十')
    if value.isdigit():
        return value
    digits = {'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
              '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
    if not value:
        return ''
    if not any(unit in value for unit in '十百千万'):
        return ''.join(str(digits[c]) for c in value) if all(c in digits for c in value) else value
    total, current = 0, 0
    for char in value:
        if char in digits:
            current = digits[char]
        elif char in '十百千':
            total += (current or 1)*{'十':10, '百':100, '千':1000}[char]
            current = 0
        elif char == '万':
            total = (total+current)*10000
            current = 0
        else:
            return value
    return str(total+current)


def _clean(value):
    value = re.sub(r'<[^>]+>', ' ', str(value or ''))
    value = value.replace('\u3000', ' ').replace('\xa0', ' ')
    return re.sub(r'[ \t]+', ' ', value).strip(' \t\r\n|')


def _normalize_line(value):
    value = _clean(value).translate(TRADITIONAL)
    cip = re.search(r'/(.+?)(?:--|—{1,2})', value)
    responsibility = _normalize_line(cip.group(1)) if cip else None
    if cip:
        value = value[:cip.start(1)]+'PDFHELPERRESPONSIBILITY'+value[cip.end(1):]
    # OCR/PDF extraction can return a right-to-left imprint in visual order.
    if '国民华中' in value or '国华中' in value:
        value = value[::-1]
    if re.search(r'(?:著|编|译|撰)[。．.]?$|^(?:作者|著者|著作人|主编|编者|译者)', value):
        # Two complete CJK names separated by a blank remain separate creators;
        # the spaced individual glyphs in "朱 金 顺 著" still join into one name.
        value = re.sub(r'([\u3400-\u9fff]{2,})\s+(?=[\u3400-\u9fff]{2,}(?:\s|$))', r'\1、', value)
    value = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', value)
    return value.replace('PDFHELPERRESPONSIBILITY', responsibility) if responsibility is not None else value


def _vertical_lines(texts, boxes):
    """Recover vertical glyph columns when OCR supplies separate glyph boxes.

    Keep the original blocks too. Never reorder a horizontal sentence by guessing
    its words; only isolated CJK glyphs are eligible for geometric regrouping.
    """
    glyphs = []
    for text, box in zip(texts, boxes):
        text = _clean(text)
        if not re.fullmatch(r'[\u3400-\u9fff〇]', text) or not isinstance(box, (list, tuple)):
            continue
        if len(box) == 4 and isinstance(box[0], (list, tuple)):
            xs, ys = zip(*box)
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        elif len(box) == 4:
            x0, y0, x1, y1 = box
        else:
            continue
        if x1 > x0 and y1 > y0:
            glyphs.append(((x0+x1)/2, (y0+y1)/2, x1-x0, y1-y0, text))
    if len(glyphs) < 3:
        return []
    width = statistics.median(g[2] for g in glyphs)
    columns = []
    for glyph in sorted(glyphs, reverse=True):
        column = next((c for c in columns if abs(c[0][0]-glyph[0]) < width*.65), None)
        if column is None:
            columns.append([glyph])
        else:
            column.append(glyph)
    return [''.join(g[4] for g in sorted(c, key=lambda g:g[1]))
            for c in columns if len(c) >= 2]


def _json_pages(path):
    """Read text from supported PaddleOCR/canonical JSON without requiring boxes."""
    raw = json.loads(Path(path).read_text(encoding='utf8'))
    if isinstance(raw, dict) and raw.get('schema') == 'zotero-paddleocr/1':
        entries = raw.get('pages', [])
        return [[_clean(line.get('text')) for line in page.get('lines', [])
                 if _clean(line.get('text'))] + _vertical_lines(
                     [line.get('text', '') for line in page.get('lines', [])],
                     [line.get('quad', line.get('bbox', [])) for line in page.get('lines', [])])
                for page in entries]
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
        boxes = ocr.get('rec_polys') or ocr.get('rec_boxes') or page.get('rec_polys') or page.get('rec_boxes') or []
        pages.append([_clean(text) for text in texts if _clean(text)] + _vertical_lines(texts, boxes))
    return pages


def _pdf_pages(path, limit):
    with fitz.open(path) as document:
        pages = []
        for index in range(min(limit, len(document))):
            page = document[index]
            lines = [_clean(line) for line in page.get_text('text').splitlines() if _clean(line)]
            words = page.get_text('words')
            pages.append(lines + _vertical_lines([w[4] for w in words], [w[:4] for w in words]))
        return pages


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
    pattern = re.compile(r'^\s*(?:'+names+r')\s*[:：]?\s*(.+?)\s*$')
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
    for name in re.split(r'[、;；]|(?:，|,(?!\s*[A-Za-z]))|\s+(?:and|与|和|&)\s+', value):
        name = re.sub(r'^\s*(?:\[[^]]+\]|【[^】]+】|\([^)]*\)|（[^）]*）)\s*', '', name).strip()
        name = re.sub(r'(?:等)?'+ROLE_SUFFIX.pattern, '', name).strip(' /。．.')
        names = re.split(r',\s*(?=[A-Za-z][^,]*\s+[A-Za-z])', name) if re.search(r'^[^,]*\s[^,]*,', name) else [name]
        for person in names:
            if 1 < len(person) <= 80 and not any(word in person for word in ('责任编辑', '装帧', '校对', '印刷', '发行')):
                result.append(person.strip())
    return list(dict.fromkeys(result))


def _creator_line(line):
    if re.search(EXCLUDED_ROLES, line):
        return None
    match = re.fullmatch(r'('+ROLES+r')[:：\s]*(.+)', line)
    if match:
        return match.group(1), match.group(2)
    match = re.fullmatch(r'(.+?)\s*('+ROLES+r')', line)
    return (match.group(2), match.group(1)) if match else None


def _creators(lines):
    result = {}
    expanded = []
    for line in lines:
        if len(re.findall(ROLES, line)) <= 1:
            expanded.append(line)
            continue
        # Responsibilities separated by semicolons/commas retain printed order.
        # Commas inside a Latin "Surname, Given" name remain intact.
        for part in re.split(r'[;；]|(?<=[著编撰译])[,，]', line):
            suffixes = list(re.finditer(r'(.+?)(编著|主编|编纂|编选|著|撰|译)(?=$|[^者作])', part))
            if len(suffixes) > 1 and not re.match(r'^(?:'+ROLES+r')[:：]', part):
                expanded.extend(m.group(0) for m in suffixes)
            else:
                expanded.append(part)
    lines = expanded
    for index, line in enumerate(lines):
        line = line.strip()
        responsibility = _creator_line(line.strip('。．. '))
        if not responsibility and re.fullmatch(ROLES, line) and index+1 < len(lines):
            responsibility = _creator_line(line+lines[index+1])
        if not responsibility:
            continue
        role, names = responsibility
        field = ('editors' if role in ('主编', '编者', '编', '编纂', '编选') else
                 'translators' if role in ('译', '译者', '翻译', '翻译者') else 'authors')
        # The responsibility label already supplied the role; names must not
        # contain another label, title punctuation, or a production staff role.
        if re.search(r'[:：/]|'+EXCLUDED_ROLES, names):
            continue
        people = _authors(names)
        if people:
            result.setdefault(field, []).extend(people)
    return {key: list(dict.fromkeys(value)) for key, value in result.items()}


def _plausible_title(line):
    return (2 <= len(line) <= 60 and not re.search(
        r'[\d:：/（）()]|CIP|ISBN|图书在版|第.+版|初版|民国|版权|出版|书局|书屋|印刷|'
        r'发行|经售|定价|地址|社址|责任|编辑|设计|著作人|作者|著者|主编|编者|装帧|全国各|禁止', line)
        and not _creator_line(line))


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
            r'(?P<publisher>[^，,。]{2,60}?(?:出版社|出版公司|书局|书社|书屋|出版中心))'
            r'\s*[,，]\s*(?P<year>(?:18|19|20|21)\d{2})', value)
        if match:
            fields = {key: _clean(text) for key, text in match.groupdict().items()}
            fields['title'] = re.sub(r'^.*?图书在版编目[（(]?CIP[）)]?数据\s*', '', fields['title'])
            return fields
    return {}


def _parse(lines):
    # Separate label/value blocks are common in both horizontal and vertical OCR.
    merged = []
    skip = False
    for index, line in enumerate(lines):
        if skip:
            skip = False
            continue
        if re.fullmatch(ROLES+r'|书名|题名|出版社|出版地|发行所', line) and index+1 < len(lines):
            merged.append(line+'：'+lines[index+1])
            skip = True
        else:
            merged.append(line)
    lines = merged
    text = '\n'.join(lines)
    cip = _structured_cip(lines)
    result = {}
    title = cip.get('title', '') or _label(lines, ('书名', '题名'))
    if title:
        title = _strip_title(title)
        if 1 < len(title) <= 150 and '图书在版编目' not in title:
            result['title'] = title

    # CIP is authoritative, including an explicit editor-only responsibility.
    # Production staff (责任编辑/发行人/装帧) are never book creators.
    creators = _creators([cip['author']] if cip.get('author') else lines)
    if cip.get('author'):
        supplementary = _creators(lines)
        for role in ('editors', 'translators'):
            if role not in creators and role in supplementary:
                creators[role] = supplementary[role]
    result.update(creators)
    if 'title' not in result:
        for index, line in enumerate(lines):
            if _creator_line(line) and index:
                previous = lines[index-1].strip('《》')
                if _plausible_title(previous):
                    result['title'] = previous
                    break
        if 'title' not in result:
            # Traditional vertical imprints often put the title in a separate
            # column; only accept an isolated, unlabelled front-matter line.
            plausible = [line.strip('《》') for line in lines if _plausible_title(line.strip('《》'))]
            if len(plausible) == 1:
                result['title'] = plausible[0]

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

    match = re.search(r'(第\s*'+NUMBER+r'\s*版)', text)
    edition = match.group(1) if match else _label(lines, ('版次', '版本'))
    if edition:
        result['edition'] = re.sub(r'\s+', '', edition).strip('，,。；;')

    publisher = cip.get('publisher', '') or _label(lines, ('出版社', '出版者', '出版发行', '发行所'))
    if not publisher:
        match = re.search(r'([\u3400-\u9fffA-Za-z0-9·（）()]{2,40}?(?:出版社|出版公司|书局|书社|书屋|出版中心))', text)
        publisher = match.group(1) if match else ''
    if publisher:
        publisher = re.sub(r'(?:出版发行|出版|发行)$', '', _clean(publisher)).strip('，,。；;')
        result['publisher'] = publisher

    place = cip.get('place', '') or _label(lines, ('出版地点', '出版地'))
    if not place:
        # Infer only an explicitly printed city prefix/address, not a printer,
        # distributor or a publisher-to-city lookup table.
        city = r'北京|上海|南京|天津|重庆|广州|武汉|成都|杭州|台北|香港'
        for line in [publisher or ''] + [v for v in lines if re.match(r'^(?:地址|社址|\(?'+city+r')', v)]:
            match = re.search(r'^(?:地址|社址)?[:：\s（(]*('+city+r')(?:市)?', line)
            if match:
                place = match.group(1)
                break
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
    if not year:
        match = re.search(r'(?:中华)?民国\s*('+NUMBER+r')\s*年', text)
        if match:
            number = _integer(match.group(1))
            if number.isdigit() and 0 < int(number) < 200:
                year = str(1911 + int(number))
    if not result.get('edition') and re.search(r'初版', text):
        result['edition'] = '第1版'
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
        lines = list(dict.fromkeys(_normalize_line(v) for v in ocr_lines + pdf_lines if _clean(v)))
        candidates.append((_page_score(lines), index, lines,
                           'PDF 文字层和 OCR JSON' if pdf_lines and ocr_lines else
                           'OCR JSON' if ocr_lines else 'PDF 文字层'))
    if not candidates or not any(lines for _, _, lines, _ in candidates):
        raise ValueError('PDF 没有可读取的文字，且未找到可复用的 OCR JSON；请先完成 OCR 或合并已有结果')
    score, index, lines, source = max(candidates, key=lambda row: row[0])
    if score < 4:
        raise ValueError('前 40 页中没有找到可信的版权页；未修改文献条目')
    fields = _parse(lines)
    additional_pages = []
    authoritative_cip = bool(_structured_cip(lines))
    for other_score, other_index, other_lines, _ in sorted(candidates, reverse=True):
        if other_index == index or other_score < 4 or abs(other_index-index) > 2:
            continue
        supplement = _parse(other_lines)
        # A nearby imprint may supply the edition and translator absent from
        # CIP. Do not overwrite CIP values or turn an editor-only CIP into authors.
        allowed = ('edition', 'volume', 'numberOfVolumes', 'editors', 'translators') if authoritative_cip else tuple(supplement)
        added = False
        for key in allowed:
            if key not in fields and key in supplement:
                fields[key] = supplement[key]
                added = True
        if added:
            additional_pages.append(other_index+1)
    if not fields:
        raise ValueError('找到了疑似版权页，但没有提取出可安全填写的字段；未修改文献条目')
    evidence = [line[:160] for line in lines if any(marker.lower() in line.lower() for marker in MARKERS)][:5]
    return {'pageIndex': index, 'pageNumber': index + 1, 'score': score,
            'source': source, 'fields': fields, 'evidence': evidence, 'additionalPages': additional_pages}
