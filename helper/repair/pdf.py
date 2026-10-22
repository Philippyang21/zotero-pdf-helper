import math
import threading
from functools import lru_cache
from pathlib import Path
import pymupdf as fitz
from .files import digest
from .schema import normalize

# MuPDF must not be called concurrently from multiple Python threads.
PDF_LOCK = threading.RLock()
FONT = fitz.Font('cjk')


@lru_cache(maxsize=16384)
def supports_character(character):
    return bool(FONT.has_glyph(ord(character)))


def inspect(path):
    with PDF_LOCK, fitz.open(path) as doc:
        if not doc.is_pdf or doc.is_encrypted or doc.needs_pass:
            raise ValueError('需要未加密的有效 PDF')
        if not len(doc):
            raise ValueError('PDF 没有页面')
        if doc.get_sigflags() > 0:
            raise ValueError('此 PDF 包含签名字段；添加文字会使签名失效，请使用未签名副本')
        return dict(pages=len(doc), bytes=Path(path).stat().st_size, sha256=digest(path),
                    dimensions=[dict(width=p.rect.width, height=p.rect.height, rotation=p.rotation) for p in doc])


def generate(source, raw, markdown, output, cancelled=lambda:False, *, legacy_scale=0, progress=lambda *args:None):
    progress('waiting',0,0)
    with PDF_LOCK, fitz.open(source) as doc:
        if doc.is_encrypted or doc.needs_pass or doc.get_sigflags() > 0:
            raise ValueError('加密或带签名 PDF 不能自动修改')
        dimensions=[dict(width=p.rect.width,height=p.rect.height) for p in doc]
        pages, warnings = normalize(raw, len(doc), markdown,pdf_dimensions=dimensions,legacy_scale=legacy_scale)
        inserted, touched = 0, []
        progress('writing',0,len(pages))
        for number,data in enumerate(pages,1):
            if cancelled():
                raise InterruptedError('已取消；原 PDF 未修改')
            page = doc[data['index']]
            # Cropbox-relative MuPDF coordinates, then undo display rotation.
            display = data['space'] == 'display'
            size = page.rect if display else fitz.Rect(0, 0, page.cropbox.width, page.cropbox.height)
            transform = page.derotation_matrix if display else fitz.Identity
            page.insert_font(fontname='OCRUnicode', fontbuffer=FONT.buffer)
            count = 0
            for line in data['lines']:
                q = [fitz.Point(x*size.width/data['width'], y*size.height/data['height'])*transform for x,y in line['quad']]
                text = line['text'].replace('\t', '    ')
                # Preserve explicit line breaks inside a located block only.
                parts = [s for s in text.splitlines() if s.strip()]
                if not parts:
                    continue
                tl, tr, br, bl = q
                u, v = tr-tl, bl-tl
                for n, part in enumerate(parts):
                    subtop = tl + v*(n/len(parts))
                    subv = v*(1/len(parts))
                    natural = FONT.text_length(part, fontsize=1)
                    if natural <= 0:
                        continue
                    unsupported = [c for c in part if not supports_character(c) and not c.isspace()]
                    if unsupported:
                        warnings.append('字体不支持部分字符：' + ''.join(dict.fromkeys(unsupported))[:24])
                    span = FONT.ascender-FONT.descender
                    baseline = subtop + subv*(FONT.ascender/span)
                    matrix = fitz.Matrix(u.x/natural, u.y/natural, subv.x/span, subv.y/span, 0, 0)
                    page.insert_text(baseline, part, fontsize=1, fontname='OCRUnicode',
                                     render_mode=3, morph=(baseline, matrix), overlay=True)
                    inserted += 1
                    count += 1
            if count:
                touched.append(data['index'])
            progress('writing',number,len(pages))
        if not inserted:
            raise ValueError('没有写入任何文字对象')
        progress('saving',0,0)
        doc.save(output, garbage=0, deflate=True, encryption=fitz.PDF_ENCRYPT_KEEP)
        expected = len(doc)
        # Structural checks only. No rasterization, remote calls, or semantic checks.
        validate(output, expected, touched,progress=progress,cancelled=cancelled)
        return dict(pages=expected, inserted=inserted, warnings=list(dict.fromkeys(warnings)), touched=touched)


def validate(path, expected, touched, *, progress=lambda *args:None,cancelled=lambda:False):
    progress('checking',0,len(touched))
    if not Path(path).is_file() or Path(path).stat().st_size == 0:
        raise ValueError('输出文件为空')
    with PDF_LOCK, fitz.open(path) as result:
        if result.is_repaired or result.page_count != expected:
            raise ValueError('输出 PDF 结构错误或页数改变')
        for number,index in enumerate(touched,1):
            if cancelled():
                raise InterruptedError('已取消；原 PDF 未修改')
            page = result[index]
            # Look for our invisible text operator in content streams, not old text.
            streams = b'\n'.join(result.xref_stream(x) for x in page.get_contents())
            if b'3 Tr' not in streams or not page.get_text().strip():
                raise ValueError(f'第 {index+1} 页文字层未通过结构检查')
            progress('checking',number,len(touched))
