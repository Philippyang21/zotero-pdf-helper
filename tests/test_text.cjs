'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
function processor(){
 const context=vm.createContext({});
 for(const file of ['options','protected','lineBreaks','whitespace','punctuation','index'])
  vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/text',file+'.js'),'utf8'),context,{filename:file+'.js'});
 return vm.runInContext('AcademicText',context);
}
const api=processor(),clean=api.cleanAcademicText;
const samples=[
 ['Chinese wrapped sentence','现代文学史料工作不仅关系到文学\n史研究，而且关系到文学研究的方法\n论建设。','现代文学史料工作不仅关系到文学史研究，而且关系到文学研究的方法论建设。'],
 ['Chinese wrong spaces','中国 现代 文学 史料 学','中国现代文学史料学'],
 ['English word spaces','Chinese modern literature','Chinese modern literature'],
 ['English wrapping','Chinese modern literature is an important\nfield of modern Chinese studies.','Chinese modern literature is an important field of modern Chinese studies.'],
 ['Chinese punctuation','朱自清认为, "诗教"是就读诗而论,作用显然也在政教.','朱自清认为，“诗教”是就读诗而论，作用显然也在政教。',{punctuation:'chinese'}],
 ['English punctuation','Smith，1928，p．23。','Smith, 1928, p. 23.',{punctuation:'english'}],
 ['Mixed language spaces unchanged','鲁迅 Lu Xun 的文学研究','鲁迅 Lu Xun 的文学研究'],
 ['Mixed language no automatic new spaces','鲁迅Lu Xun研究','鲁迅Lu Xun研究'],
 ['Mixed language opt in','鲁迅Lu Xun研究','鲁迅 Lu Xun 研究',{mixedSpaces:true}],
 ['Paragraphs','第一段文字。\n\n第二段文字。','第一段文字。\n\n第二段文字。'],
 ['Paragraph indentation','第一行\n  第二段落\n继续。','第一行\n  第二段落继续。'],
 ['Consecutive whitespace','Chinese   modern\u00A0\u3000literature','Chinese modern literature'],
 ['Chinese punctuation spacing','鲁迅认为 ， “文学革命” 并非如此 。','鲁迅认为，“文学革命”并非如此。'],
 ['Space before Chinese quotation','制造 “碎片化” 与 “整体化” 的对立。','制造“碎片化”与“整体化”的对立。'],
 ['Chinese parentheses and corner quotes','他说 （ 中文 ） 与 「 中文 」 和 『 中文 』。','他说（中文）与「中文」和『中文』。'],
 ['English typographic quotes retain word spaces','English “quoted words” stay separate.','English “quoted words” stay separate.'],
 ['Mixed content keeps English words inside Chinese quotes','他说 “Chinese modern literature” 如此。','他说“Chinese modern literature”如此。'],
 ['Quote spacing switch disabled','他说 “中文” 如此。','他说 “中文” 如此。',{punctuationSpaces:false}],
 ['Unicode PDF spaces in Han','中国\u2009现代\u2002文学\u200A史料\u205F学','中国现代文学史料学'],
 ['Unicode Han spaces without general collapse','中国\u2009现代\u2002文学','中国现代文学',{collapseSpaces:false}],
 ['Unicode spaces around Chinese quotes without collapse','制造\u2009“碎片化”\u2002与\u200A“整体化”\u205F的对立。','制造“碎片化”与“整体化”的对立。',{collapseSpaces:false}],
 ['Zero width between Han only','中\u200B文\uFEFF学 English\u200Bwords 中\u200DEnglish','中文学 English\u200Bwords 中\u200DEnglish'],
 ['Supplementary Han with Unicode spaces','𠮷\u2009朗\u2002﨑\u200B㑇','𠮷朗﨑㑇'],
 ['Chinese space option off keeps normalized separator','中国\u2009文学','中国 文学',{removeChineseSpaces:false}],
 ['Chinese zero width option off','中国\u200B文学','中国\u200B文学',{removeChineseSpaces:false}],
 ['Fullwidth letters and digits','ＡＢＣ１２３','ABC123'],
 ['Known hyphen break','litera-\nture','literature'],
 ['Soft hyphen break','experi\u00AD\nmental','experimental'],
 ['Ambiguous hyphen retained','well-\nknown','well-\nknown'],
 ['Unknown split retained','mysteri-\nology','mysteri-\nology'],
 ['Hyphen switch disabled','litera-\nture','litera-\nture',{dehyphenate:false}],
 ['Line break switch disabled','中国\n文学','中国\n文学',{repairLineBreaks:false}],
 ['Chinese spaces switch disabled','中国 文学','中国 文学',{removeChineseSpaces:false}],
 ['Space collapse switch disabled','Chinese   literature','Chinese   literature',{collapseSpaces:false}],
 ['Width switch disabled','ＡＢＣ１２３','ＡＢＣ１２３',{normalizeLetters:false}],
 ['Punctuation kept','朱自清认为, "诗教"如此.','朱自清认为, "诗教"如此.',{punctuation:'preserve'}],
 ['English paragraph retained in Chinese mode','Smith says, "This is literature." (1928)','Smith says, "This is literature." (1928)',{punctuation:'chinese'}],
 ['Nested English quotes','他说：“她说‘好’。”','他说: "她说\'好\'."',{punctuation:'english'}],
 ['Apostrophe retained',"Don't change O'Neill's text.","Don't change O'Neill's text.",{punctuation:'english'}],
 ['Unmatched quotes preserved','他说“未结束','他说“未结束',{punctuation:'english'}],
 ['Quote context after supplementary characters','𠮷'.repeat(24)+'文学说 "text"','𠮷'.repeat(24)+'文学说“text”'],
 ['Supplementary Han and old glyphs','𠮷 朗 﨑 㑇 ︱ ※ 〝〞 ……','𠮷朗﨑㑇 ︱ ※ 〝〞 ……'],
 ['Replacement symbol kept by default','文字\uFFFD与\u0001原刊※','文字\uFFFD与\u0001原刊※'],
 ['OCR artifact option','中 \uFFFD 文\u0001※𠮷','中文※𠮷',{removeOcrArtifacts:true}],
 ['English NFC composition','Educac\u0327a\u0303o','Educação'],
 ['Windows newlines','中国\r\n现代\r文学\u2028研究','中国现代文学研究'],
 ['Unicode paragraph boundary','第一段。\u2029第二段。','第一段。\n\n第二段。'],
 ['Numbered Chinese list','1. 中国 文学\n2. 文学 研究','1. 中国文学\n2. 文学研究'],
 ['Markdown headings','## 中国文学\n史料研究','## 中国文学\n史料研究'],
 ['Bullets retained','- 中国文学\n- 文献研究','- 中国文学\n- 文献研究'],
 ['Disabling paragraph retention is conservative','第一段\n\n第二段','第一段第二段',{keepParagraphs:false}],
 ['Empty input','',''],
 ['Only whitespace',' \n\t ',''],
];
for(const [name,input,expected,options] of samples)test('clean: '+name,()=>{
 assert.equal(clean(input,options),expected);
 assert.equal(clean(expected,options),expected,'must be idempotent');
});
test('reported page-55 highlight is fully cleaned in one pass and stays stable',()=>{
 const input='至于论者热衷于制造 “碎片化” 与 “整体化” 的虚假对立,正如制造文献史料研究与理论批 评、文学史研究的虚假对立一样,乃是对文献史料研究的性质及其与理论批评、文学史研究的关系 缺乏较深入之认识所致。以至今尚未 “古典化” “历史化” 的当代文献史料的整理与研究为例,洪 子诚在接受笔者访谈时即已声明,“史料与文学批评、文学史研究之间,是一个互相推进、辩驳、制';
 const expected='至于论者热衷于制造“碎片化”与“整体化”的虚假对立，正如制造文献史料研究与理论批评、文学史研究的虚假对立一样，乃是对文献史料研究的性质及其与理论批评、文学史研究的关系缺乏较深入之认识所致。以至今尚未“古典化”“历史化”的当代文献史料的整理与研究为例，洪子诚在接受笔者访谈时即已声明，“史料与文学批评、文学史研究之间，是一个互相推进、辩驳、制';
 assert.equal(clean(input),expected);assert.equal(clean(expected),expected);
 assert.equal(clean(input,{enabled:false}),input);
});
test('all horizontal Unicode space variants clean once without removing paragraph boundaries',()=>{
 for(const char of ['\t',' ','\u00A0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007','\u2008','\u2009','\u200A','\u202F','\u205F','\u3000','\u200B','\uFEFF']){
  for(const collapseSpaces of [true,false]){
   const result=clean('中'+char+'文',{collapseSpaces});assert.equal(result,'中文',char.codePointAt(0).toString(16));
   assert.equal(clean(result,{collapseSpaces}),result);
  }
 }
 assert.equal(clean('中国\n\n文学'),'中国\n\n文学');
 assert.equal(clean('中国\n文学',{repairLineBreaks:false}),'中国\n文学');
});
const protectedSamples=[
 'https://example.com/a,b?x=1.2', 'DOI: 10.1234/abc.2026.01', '10.1234/abc.2026.01',
 'test@example.com', '3.14159', 'v2.1.0', 'ISBN: 978-7-123-45678-9', 'ISSN 1234-567X',
 'C:\\Users\\test\\paper.pdf', '"C:\\My Documents\\book,paper.pdf"', '/usr/local/paper.pdf',
 '../notes/test.json', '[中国 文学](https://example.com/a,b?x=1.2)', '<span title="a,b">',
 '`text.replace(/a,b/g, "x")`', 'Smith, 1928, p. 23.', 'pp. 23–25.', 'e.g.', 'J. Smith',
 '1928–1930', '12:30', 'foo.json', '...', '[代码 `x,y`](https://example.com/a,b)',
 '```js\nconst a = "中 文";\n\nconsole.log(a,b);\n```', '<code>中 文,a,b</code>',
 '`中\u2009文 “原 样”`', '<code>中\u200B文 “原 样”</code>',
];
for(const sample of protectedSamples)test('protected: '+sample.split('\n')[0],()=>{
 for(const punctuation of ['smart','chinese','english']){
  const result=clean('文字 '+sample+' 结束。',{punctuation});
  assert.ok(result.includes(sample),JSON.stringify(result));
  assert.equal(clean(result,{punctuation}),result);
 }
});
test('presets and master off do not mutate caller options or originals',()=>{
 const original='中国 文学,\nＡＢＣ１２３.';
 assert.equal(clean(original,{enabled:false}),original);
 assert.equal(clean(original,{preset:'light'}),'中国文学, ＡＢＣ１２３.');
 const options={punctuation:'chinese',keepParagraphs:true},before=JSON.stringify(options);
 clean(original,options);assert.equal(JSON.stringify(options),before);
 assert.equal(api.preset('paper').mixedSpaces,false);assert.equal(api.preset('paper').removeOcrArtifacts,false);
 assert.equal(api.preset('light').punctuation,'preserve');
});
test('idempotence across modes, preset options and mixed excerpts',()=>{
 const corpus=samples.map(v=>v[1]).concat(protectedSamples).join('\n\n');
 for(const punctuation of ['preserve','smart','chinese','english'])for(const keepParagraphs of [true,false])for(const mixedSpaces of [true,false]){
  const options={punctuation,keepParagraphs,mixedSpaces};
  const once=clean(corpus,options);assert.equal(clean(once,options),once,JSON.stringify(options));
 }
});
test('private-use characters never collide with protected markers',()=>{
 const input='史料 \uE000\uE0010\uE003 https://example.com/a,b?x=1.2';
 assert.equal(clean(input),input);
});
test('typical annotations complete locally without process or network globals',()=>{
 const input='中国 现代 文学, "史料研究"仍需校对. DOI: 10.1234/abc.2026.01\n'.repeat(30);
 const started=performance.now();
 for(let n=0;n<50;n++)clean(input);
 const average=(performance.now()-started)/50;
 assert.ok(average<50,`average ${average.toFixed(2)} ms`);
 console.log('Text cleaner ~'+average.toFixed(2)+' ms for '+input.length+' characters');
});
