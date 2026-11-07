"""Offline copyright-page extraction tests. No Zotero library or OCR API involved."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'helper'))
from repair.copyright import extract, _parse, _normalize_line


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

    def parsed(self, text):
        return _parse([_normalize_line(line) for line in text.splitlines() if line.strip()])

    def test_spaced_author_on_1986_unlabelled_imprint(self):
        fields = self.parsed('新文学资料引论\n朱 金 顺 著\n北京语言学院出版社出版\n（北京市海淀区学院路15号）\n新华书店北京发行所发行\n北京市海淀区印刷厂印刷\n1986年10月第一版 1986年10月第一次印刷')
        self.assertEqual(fields, dict(title='新文学资料引论', authors=['朱金顺'],
                                     publisher='北京语言学院出版社', place='北京', date='1986', edition='第一版'))

    def test_cip_priority_and_reprint_does_not_replace_edition(self):
        fields = self.parsed('图书在版编目（CIP）数据\n中国现代文学史料学 / 刘增杰著. — 上海：中西\n书局，2012.3（2012.7重印）\nISBN 978-7-5475-0350-8\n中国现代文学史料学\n刘增杰 著\n责任编辑 张安庆 路征远\n出版发行 上海文艺出版（集团）有限公司\n中西书局\n地址 上海市打浦路443号\n版次 2012年3月第1版 2012年7月第2次印刷')
        self.assertEqual(fields['title'], '中国现代文学史料学')
        self.assertEqual(fields['authors'], ['刘增杰'])
        self.assertNotIn('editors', fields)
        self.assertEqual(fields['publisher'], '中西书局')
        self.assertEqual(fields['place'], '上海')
        self.assertEqual(fields['edition'], '第1版')
        self.assertEqual(fields['date'], '2012')

    def test_republic_vertical_imprint_and_reversed_date(self):
        fields = self.parsed('新 詩 雜 話\n著作人 朱自清\n發行人 姚蓬子\n發行所 作家書屋\n上海中山中路六二〇號\n版初月二十年六十三國民華中\n經售處 全國各大書店\n版權所有不准翻印')
        self.assertEqual(fields['title'], '新诗杂话')
        self.assertEqual(fields['authors'], ['朱自清'])
        self.assertEqual(fields['publisher'], '作家书屋')
        self.assertEqual(fields['place'], '上海')
        self.assertEqual(fields['date'], '1947')
        self.assertEqual(fields['edition'], '第1版')

    def test_republic_chinese_year_numbers_and_printed_separate_labels(self):
        for year, expected in [('廿六', '1937'), ('一〇一', '2012'), ('一百零一', '2012')]:
            fields = self.parsed('版权页\n文学论\n著作人\n张三\n发行所\n作家书屋\n出版地\n上海\n民国'+year+'年初版')
            self.assertEqual(fields['date'], expected)
            self.assertEqual(fields['authors'], ['张三'])
            self.assertEqual(fields['place'], '上海')

    def test_cip_and_nearby_imprint_supply_separate_evidence(self):
        path = self.pdf(['图书在版编目（CIP）数据\n文学论 / 王五主编. -- 上海：学术出版社，2012.\nISBN 978-7-00-000000-0',
                         '版权页\n书名：错误标题\n作者：错误作者\n译者：李四、张三\n出版社：另一出版社\n2012年3月第1版 2015年第2次印刷'])
        result = extract(path)
        self.assertEqual(result['fields']['title'], '文学论')
        self.assertNotIn('authors', result['fields'])
        self.assertEqual(result['fields']['editors'], ['王五'])
        self.assertEqual(result['fields']['translators'], ['李四', '张三'])
        self.assertEqual(result['fields']['publisher'], '学术出版社')
        self.assertEqual(result['fields']['date'], '2012')
        self.assertEqual(result['fields']['edition'], '第1版')
        self.assertEqual(result['additionalPages'], [2])

    def test_multiple_authors_editors_translators_in_printed_order(self):
        fields = self.parsed('版权页\n书名：文学论\n作者：王五、张三、李四\n主编：赵六、钱七\n译者：周八、吴九\n责任编辑：孙十\n2020年第1版')
        self.assertEqual(fields['authors'], ['王五', '张三', '李四'])
        self.assertEqual(fields['editors'], ['赵六', '钱七'])
        self.assertEqual(fields['translators'], ['周八', '吴九'])

    def test_foreign_cip_responsibilities_and_editor_only_book(self):
        fields = self.parsed('图书在版编目（CIP）数据\n文学论 / [英] Virginia Woolf、E. M. Forster著；王五、李四译. -- 上海：学术出版社，2020.\n责任编辑：张三')
        self.assertEqual(fields['authors'], ['Virginia Woolf', 'E. M. Forster'])
        self.assertEqual(fields['translators'], ['王五', '李四'])
        self.assertNotIn('editors', fields)
        fields = self.parsed('图书在版编目（CIP）数据\n文学资料 / 王五、李四主编. -- 上海：学术出版社，2020.\n作者：错误来源')
        self.assertEqual(fields['editors'], ['王五', '李四'])
        self.assertNotIn('authors', fields)

    def test_single_glyph_ocr_columns_are_reassembled_for_republic_book(self):
        path = self.pdf([''])
        lines = []
        for column, text in enumerate(['新詩雜話', '著作人朱自清', '發行人姚蓬子', '發行所作家書屋', '上海', '中華民國三十六年十二月初版']):
            x = 500-column*65
            for row, glyph in enumerate(text):
                lines.append({'text': glyph, 'bbox': [x, 20+row*22, x+16, 36+row*22]})
        data = {'schema': 'zotero-paddleocr/1', 'pages': [{'lines': lines}]}
        json_path = self.root/'vertical.json'
        json_path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
        fields = extract(path, json_path)['fields']
        self.assertEqual(fields['authors'], ['朱自清'])
        self.assertEqual(fields['date'], '1947')
        self.assertEqual(fields['publisher'], '作家书屋')

    def test_space_separated_chinese_authors_and_separate_translation_line(self):
        fields = self.parsed('图书在版编目（CIP）数据\n文学论 / 张三 李四 王五 著. -- 上海：学术出版社，2020.\n译者 陈甲、陈乙')
        self.assertEqual(fields['authors'], ['张三', '李四', '王五'])
        self.assertEqual(fields['translators'], ['陈甲', '陈乙'])

    def test_latin_full_names_and_inverted_name_are_not_misordered(self):
        fields = self.parsed('版权页\n作者：John Smith, Jane Doe\n译者：Smith, John；Doe, Jane\n2020年第1版')
        self.assertEqual(fields['authors'], ['John Smith', 'Jane Doe'])
        self.assertEqual(fields['translators'], ['Smith, John', 'Doe, Jane'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
