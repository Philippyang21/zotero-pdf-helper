"""Standalone entry point run with the user's PaddleOCR interpreter (never the PDF helper)."""
import base64
import io
import json
import os
import queue
import threading
import time
import sys
from importlib.metadata import version
from pathlib import Path


def portable_markdown(md):
    # Zotero imports the Markdown attachment alone; keep figure references portable.
    text = md['markdown_texts']
    for name, image in md.get('markdown_images', {}).items():
        if name not in text:
            continue
        buffer = io.BytesIO()
        image.convert('RGB').save(buffer, format='JPEG', quality=85)
        uri = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
        text = text.replace('src="'+name+'"', 'src="'+uri+'"').replace(']('+name+')', ']('+uri+')')
    return text


def select_device(requested, paddle):
    if requested == 'cpu':
        return 'cpu'
    try:
        if paddle.is_compiled_with_cuda() and paddle.device.cuda.device_count():
            # A driver may enumerate the card even when its runtime cannot initialise.
            paddle.to_tensor([1], place=paddle.CUDAPlace(0)).numpy()
            return 'gpu:0'
    except (RuntimeError, OSError, ValueError):
        pass
    if requested == 'auto':
        return 'cpu'
    raise ValueError('CUDA GPU 不可用。请选择自动或 CPU，或检查显卡驱动和 Paddle 环境')


def parse_pdf(pipeline, directory):
    import pypdfium2 as pdfium
    import numpy as np
    with pdfium.PdfDocument(str(directory/'source.pdf')) as pdf:
        for index in range(len(pdf)):
            checkpoint = directory/'local-pages'/f'{index}.json'
            if checkpoint.is_file():
                continue
            page = pdf[index]
            try:
                # Adaptive render scale: cap the long edge at 2000 px to avoid
                # feeding multi-megapixel scans into the pipeline (very slow,
                # may exhaust GPU memory). Small pages still get scale=2.
                rect = page.get_size()
                longest = max(rect[0], rect[1])
                scale = min(2.0, 2000.0 / longest) if longest > 0 else 2.0
                bitmap = page.render(scale=scale)
                try:
                    pixels = np.array(bitmap.to_pil().convert('RGB'))[:, :, ::-1].copy()
                finally:
                    bitmap.close()
            finally:
                page.close()
            results = list(pipeline.predict(input=pixels))
            if len(results) != 1 or 'error' in results[0]:
                raise ValueError(f'第 {index+1} 页未取得有效的版面识别结果')
            result = results[0]
            raw = result.json
            raw = raw.get('res', raw)
            height, width = pixels.shape[:2]
            if (raw.get('width', width), raw.get('height', height)) != (width, height):
                raise ValueError(f'第 {index+1} 页坐标尺寸与输入图像不符')
            raw.update(width=width, height=height, page_index=index, page_count=len(pdf))
            record = dict(page=raw, markdown=portable_markdown(result.markdown))
            temp = checkpoint.with_suffix('.tmp')
            with temp.open('w', encoding='utf8') as out:
                json.dump(record, out, ensure_ascii=False)
            os.replace(temp, checkpoint)


def run():
    import paddle
    import pypdfium2  # Verify the PDF input dependency during the environment check.
    from paddleocr import PPStructureV3
    verb, requested, config, formula = sys.argv[1:5]
    device = select_device(requested, paddle)
    if verb == 'check':
        print('PDF_HELPER_OK '+json.dumps({'version':version('paddleocr'), 'device':device}), flush=True)
        return
    options = dict(device=device, use_doc_orientation_classify=False, use_doc_unwarping=False,
                   use_formula_recognition=formula=='yes', formula_recognition_batch_size=1, text_recognition_batch_size=4)
    if device == 'cpu':
        options.update(cpu_threads=min(4, os.cpu_count() or 1))
        # The 3.3 CPU oneDNN executor rejects PIR ArrayAttribute in text detection.
        if paddle.__version__.split('.')[:2] == ['3','3']:
            options['enable_mkldnn'] = False
    if config:
        options['paddlex_config'] = config
    commands = queue.Queue()
    def receive():
        for line in sys.stdin.buffer:
            commands.put(json.loads(line))
        os._exit(0)  # Parent exited, including during inference.
    threading.Thread(target=receive, daemon=True).start()
    pipeline = None
    while True:
        command = commands.get()
        directory = Path(command['directory'])
        status = directory/'local-status.json'
        def report(stage, **details):
            record = dict(attempt=command['attempt'], stage=stage, device=device, **details)
            temp = status.with_suffix('.tmp')
            temp.write_text(json.dumps(record),encoding='utf8')
            for retry in range(10):
                try:
                    os.replace(temp, status)
                    break
                except PermissionError:
                    if os.name != 'nt' or retry == 9:
                        raise
                    time.sleep(.02)  # A progress poll may still have the previous file open.
        reused = pipeline is not None
        start = time.monotonic()
        report('loading')
        if not reused:
            pipeline = PPStructureV3(**options)
        load_seconds = round(time.monotonic()-start,2)
        report('local', reused=reused, loadSeconds=load_seconds)
        parse_pdf(pipeline, directory)
        report('complete', reused=reused, loadSeconds=load_seconds)


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print('PDF_HELPER_ERROR '+str(exc).replace('\n',' ')[:420], file=sys.stderr, flush=True)
        os._exit(1)  # The command reader may still be waiting on the parent pipe.
