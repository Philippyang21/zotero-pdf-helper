"""Offline copyright-page extraction tests. No Zotero library or OCR API involved."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'helper'))
from repair.copyright import extract


class CopyrightTests(unittest.TestCase):
    def setUp(self):
        scratch = Path.cwd() / 'work' / 'test-temp'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def pdf(self, pages, name='book.pdf'):
        path = self.root / name
        with fitz.open() as document:
            for text in pages:
                page = document.new_page()
                if text:
                    page.insert_textbox(fitz.Rect(45, 45, 550, 780), text,
                                        fontname='china-s', fontsize=11)
            document.save(path)
        return path

    def test_cip_line_extracts_core_book_fields(self):
        path = self.pdf([
            '扉页\n中国现代文学史料学',
            '图书在版编目（CIP）数据\n中国现代文学史料学 / 刘增杰著. -- 北京 : 人民文学出版社, 2012.\nISBN 978-7-02-000000-0',
            '目录\n第一章',
        ])
        result = extract(path)
        self.assertEqual(result['pageNumber'], 2)
        self.assertEqual(result['fields']['title'], '中国现代文学史料学')
        self.assertEqual(result['fields']['authors'], ['刘增杰'])
        self.assertEqual(result['fields']['publisher'], '人民文学出版社')
        self.assertEqual(result['fields']['place'], '北京')
        self.assertEqual(result['fields']['date'], '2012')

    def test_labelled_page_extracts_volume_total_and_edition(self):
        path = self.pdf(['\n'.join([
            '版权页', '书名：中国文学史 第三卷', '作者：张三、李四 编著',
            '全四卷', '2020年5月第2版', '出版社：学术出版社', '出版地：上海',
        ])])
        fields = extract(path)['fields']
        self.assertEqual(fields['volume'], '第三卷')
        self.assertEqual(fields['numberOfVolumes'], '4')
        self.assertEqual(fields['edition'], '第2版')
        self.assertEqual(fields['date'], '2020')
        self.assertEqual(fields['authors'], ['张三', '李四'])

    def test_ocr_json_is_used_for_image_only_pdf(self):
        path = self.pdf([''])
        data = {'schema': 'zotero-paddleocr/1', 'pages': [{'index': 0, 'lines': [
            {'text': '图书在版编目（CIP）数据'},
            {'text': '山水志 / 王五著. -- 南京 : 江南出版社, 2018.'},
            {'text': 'ISBN 978-7-00-000000-0'},
        ]}]}
        json_path = self.root / 'book.json'
        json_path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
        result = extract(path, json_path)
        self.assertEqual(result['source'], 'OCR JSON')
        self.assertEqual(result['fields']['title'], '山水志')
        self.assertEqual(result['fields']['authors'], ['王五'])

    def test_unrelated_front_matter_is_rejected(self):
        path = self.pdf(['序言\n这是一本普通书。', '目录\n第一章\n第二章'])
        with self.assertRaisesRegex(ValueError, '没有找到可信'):
            extract(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
