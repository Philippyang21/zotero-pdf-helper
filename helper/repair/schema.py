"""Strict adapters for documented PaddleOCR JSON and our explicit portable schema.

Never infer a page size from the last text box or spread Markdown across pages.
"""
import html
import math
import re
from pathlib import Path


def clean_text(text):
    return ''.join(c for c in html.unescape(str(text)) if c in '\n\t' or ord(c) >= 32)


def quad(box):
    if not isinstance(box, (list, tuple)):
        raise ValueError('文字坐标缺失')
    if len(box) == 4 and all(isinstance(v, (int, float)) for v in box):
        x0, y0, x1, y1 = box
        pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    elif len(box) == 4 and all(isinstance(v, (list, tuple)) and len(v) == 2 for v in box):
        pts = box
    else:
        raise ValueError('边界框必须是 [x0,y0,x1,y1] 或四点多边形')
    if not all(isinstance(n, (int, float)) and math.isfinite(n) for p in pts for n in p):
        raise ValueError('坐标包含无效数字')
    if math.dist(pts[0], pts[1]) <= 0 or math.dist(pts[0], pts[3]) <= 0:
        raise ValueError('文字框面积为零')
    return [list(p) for p in pts]


def _unpack(raw):
    if isinstance(raw, dict) and raw.get('schema') == 'zotero-paddleocr/1':
        return raw['pages'], True
    entries = raw if isinstance(raw, list) else [raw]
    pages = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError('JSON 根节点类型不支持')
        result = entry.get('result', entry)
        if 'layoutParsingResults' in result:
            # Official arrays are in document page order; prunedResult omits page_index.
            pages.extend(result['layoutParsingResults'])
        elif 'res' in result:
            pages.append(result['res'])
        elif 'prunedResult' in result or 'parsing_res_list' in result or 'overall_ocr_res' in result:
            pages.append(result)
        elif 'pages' in result:
            raise ValueError('通用 pages JSON 请转换为文档中的 zotero-paddleocr/1 格式')
        else:
            raise ValueError('不支持的 OCR JSON；需要 PaddleOCR 定位结果或标准化格式')
    return pages, False


def normalize(raw, expected_pages, markdown='', *, pdf_dimensions=None, legacy_scale=0):
    entries, canonical = _unpack(raw)
    if len(entries) != expected_pages:
        raise ValueError(f'JSON 含 {len(entries)} 页，PDF 含 {expected_pages} 页；禁止错页合并')
    normalized, seen, warnings = [], set(), []
    for position, entry in enumerate(entries):
        page = entry if canonical else entry.get('prunedResult', entry)
        if not isinstance(page, dict):
            raise ValueError('模型未返回可用的 prunedResult；保留结果，不调用第二个模型')
        index = page.get('index', position) if canonical else page.get('page_index', position)
        index = position if index is None else index
        if type(index) is not int or not 0 <= index < expected_pages or index in seen:
            raise ValueError('JSON 页码重复或越界；页码必须从 0 开始')
        seen.add(index)
        width, height = page.get('width',entry.get('width')), page.get('height',entry.get('height'))
        if not canonical and (width is None or height is None) and legacy_scale and pdf_dimensions:
            if not isinstance(legacy_scale,(float,int)) or not math.isfinite(legacy_scale) or not 0 < legacy_scale <= 8:
                raise ValueError('旧版 PDF 坐标倍率必须大于 0 且不超过 8')
            # Explicit user-selected render scale, never deduced from text extents,
            # embedded scan pixel counts, or service thumbnails.
            dimensions=pdf_dimensions[index]
            width=math.ceil(dimensions['width']*legacy_scale) if width is None else width
            height=math.ceil(dimensions['height']*legacy_scale) if height is None else height
            warnings.append(f'旧版 JSON 缺尺寸：按设置的 PDF 渲染倍率 {legacy_scale:g} 与原 PDF 逐页尺寸映射坐标')
        if not all(isinstance(v, (float, int)) and math.isfinite(v) and v > 0 for v in [width, height]):
            raise ValueError(f'第 {index+1} 页缺少 width/height。旧版 PaddleOCR PDF 结果可在插件设置中指定已知的 PDF 坐标倍率（常见为 2）；或提供含真实尺寸的 JSON。不会重新 OCR')
        pre = page.get('doc_preprocessor_res', {})
        if pre.get('model_settings', {}).get('use_doc_unwarping') or pre.get('angle', 0) not in (0, -1, None):
            raise ValueError('JSON 使用了扭曲矫正/自动转向，缺少反变换；请提供原图坐标结果')
        origin = page.get('origin', 'top-left')
        space = page.get('space', 'display')
        if origin not in ('top-left', 'bottom-left') or space not in ('display', 'unrotated'):
            raise ValueError('不支持的坐标原点或页面空间')
        lines = []
        if canonical:
            for order, line in enumerate(page.get('lines', [])):
                text = clean_text(line.get('text', ''))
                if text.strip():
                    lines.append(dict(text=text, quad=quad(line.get('quad', line.get('bbox'))), order=line.get('order', order)))
        else:
            blocks = page.get('parsing_res_list', [])
            ocr = page.get('overall_ocr_res', {})
            texts = ocr.get('rec_texts', [])
            boxes = ocr.get('rec_polys') or ocr.get('rec_boxes') or []
            if texts and len(texts) != len(boxes):
                raise ValueError('rec_texts 与 rec_polys/rec_boxes 数量不一致')
            for order, (text, box) in enumerate(zip(texts, boxes)):
                text = clean_text(text)
                if not text.strip():
                    continue
                q = quad(box)
                cx, cy = sum(p[0] for p in q)/4, sum(p[1] for p in q)/4
                owners = []
                for bindex, block in enumerate(blocks):
                    bbox = block.get('block_bbox')
                    if bbox and bbox[0] <= cx <= bbox[2] and bbox[1] <= cy <= bbox[3]:
                        owners.append(((bbox[2]-bbox[0])*(bbox[3]-bbox[1]), bindex))
                owner = min(owners)[1] if owners else len(blocks)
                lines.append(dict(text=text, quad=q, order=(owner, min(p[1] for p in q), order)))
            if not lines:
                # Block-level coordinates remain useful but selection is less precise.
                for order, block in enumerate(blocks):
                    if block.get('block_label') in ('image', 'chart', 'seal'):
                        continue
                    text = re.sub('<[^>]+>', ' ', clean_text(block.get('block_content', ''))).strip()
                    if text:
                        lines.append(dict(text=text, quad=quad(block.get('block_bbox')), order=order))
                if lines:
                    warnings.append(f'第 {index+1} 页仅有块级定位，复制范围可能较宽')
        lines.sort(key=lambda line: line['order'])
        for line in lines:
            q = line['quad']
            if origin == 'bottom-left':
                # Convert bbox/corner points then restore TL,TR,BR,BL in top-left space.
                q = [[p[0], height-p[1]] for p in q]
                q = [q[3], q[2], q[1], q[0]]
            if any(x < -width*.03 or x > width*1.03 or y < -height*.03 or y > height*1.03 for x,y in q):
                raise ValueError(f'第 {index+1} 页文字框大幅超出页面；坐标尺度可能不匹配')
            line['quad'] = q
        normalized.append(dict(index=index, width=width, height=height, space=space, lines=lines))
    normalized.sort(key=lambda p:p['index'])
    if not any(p['lines'] for p in normalized):
        raise ValueError('JSON 没有可定位的文字；原始文件未修改')
    # Advisory only: OCR spelling/Markdown differences never gate replacement.
    compact = lambda s: re.sub(r'\s+', '', s)
    text_len = len(compact(''.join(l['text'] for p in normalized for l in p['lines'])))
    md_len = len(compact(markdown))
    if md_len and (text_len < md_len*.45 or text_len > md_len*2.5):
        warnings.append('MD 与定位文本长度差异较大；仅记录提醒，不执行校对或再次 OCR')
    return normalized, list(dict.fromkeys(warnings))
