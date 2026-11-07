'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../plugin/content/markdownHighlights.js'),'utf8');
function load(extra={}){const c=vm.createContext({TextDecoder,setTimeout,clearTimeout,...extra});vm.runInContext(code,c);return c;}
const render=load().PDFHelperMarkdown.render;
const ann=(text,key='ANN00001',extra={})=>({text,key,page:'3',type:'highlight',color:'#ffd400',sortIndex:'00003',...extra});
test('unique quotation ignores whitespace, retains original layout and has an AI-readable index',()=>{
 const original='# 阅读\r\n\r\n这是中国 现代\n文学史。\r\n';
 const result=render(original,[ann('中国现代文学')],'PDF00001');
 assert.equal(result.matched,1);assert.match(result.text,/<mark data-pdf-helper="PDF00001:ANN00001">中国 现代\n文学<\/mark>/);
 assert.match(result.text,/> 中国现代文学/);assert.match(result.text,/第 3 页/);
 assert.equal(load().PDFHelperMarkdown.strip(result.text,'PDF00001'),original);
 assert.equal(render(result.text,[ann('中国现代文学')],'PDF00001').text,result.text);
 assert.equal(render(result.text,[],'PDF00001').text,original);
});
test('duplicate phrases and OCR mismatches are indexed without choosing an arbitrary occurrence',()=>{
 const r=render('同一段话。\n同一段话。',[ann('同一段话'),ann('OCR错字','ANN00002')],'PDF00001');
 assert.equal(r.matched,0);assert.equal(r.total,2);assert.doesNotMatch(r.text,/data-pdf-helper=/);
 assert.match(r.text,/> 同一段话/);assert.match(r.text,/> OCR错字/);
});
test('overlapping selections merge into one valid mark and removal regenerates the remaining selection',()=>{
 const a=ann('甲乙丙丁'),b=ann('丙丁戊己','ANN00002');
 const r=render('甲乙丙丁戊己。',[a,b],'PDF00001');
 assert.equal((r.text.match(/<mark data-/g)||[]).length,1);
 assert.match(r.text,/>甲乙丙丁戊己<\/mark>/);
 const updated=render(r.text,[b],'PDF00001');assert.match(updated.text,/甲乙<mark[^>]+>丙丁戊己<\/mark>/);
 assert.doesNotMatch(updated.text,/ANN00001/);
});
test('code, links and HTML attributes are not edited; annotations and comments are escaped',()=>{
 const source='```md\n代码内容\n```\n`内联代码`\n[链接文字](https://example.com)\n<div title="属性内容">正文</div>';
 const r=render(source,[ann('代码内容'),ann('内联代码','ANN00002'),ann('链接文字','ANN00003'),ann('属性内容','ANN00004'),ann('正文','ANN00005',{comment:'<script>alert(1)</script>'})],'PDF00001');
 assert.equal(r.matched,1);assert.match(r.text,/<div title="属性内容"><mark[^>]+>正文<\/mark><\/div>/);
 assert.match(r.text,/&lt;script&gt;/);assert.equal(load().PDFHelperMarkdown.strip(r.text,'PDF00001'),source);
});
test('unclosed fences stay untouched and corrupt management blocks fail without overwriting',()=>{
 assert.equal(render('```\n正文',[ann('正文')],'PDF00001').matched,0);
 assert.throws(()=>render('abc<!-- pdf-helper-highlights:PDF00001 -->',[],'PDF00001'),/不完整/);
});
test('user marks, BOM and blank lines are preserved after deleting the final annotation',()=>{
 const source='\ufeff用户 <mark>自己的标记</mark>\n\n正文内容\n\n';
 const r=render(source,[ann('正文内容')],'PDF00001');
 assert.equal(render(r.text,[],'PDF00001').text,source);
});
function fixture(){
 const files=new Map(),items=new Map(),saved=[],notifications=[];let observer;
 const item=(id,key,fields={})=>{const v={id,key,libraryID:1,parentID:1,deleted:false,isAttachment:()=>true,isAnnotation:()=>false,isEditable:()=>true,
  isLinkedFileAttachment:()=>false,getFilePathAsync:async()=>v.file,saveTx:async()=>saved.push(id),...fields};items.set(id,v);return v;};
 const parent=item(1,'PARENT01',{getAttachments:()=>[2,3]});
 const pdf=item(2,'PDF00001',{attachmentReaderType:'pdf',attachmentFilename:'scan.pdf',getAnnotations:()=>[...items.values()].filter(i=>i.parentID===2&&!i.deleted)});
 const md=item(3,'MD000001',{attachmentFilename:'scan.md',file:'/scan.md'});
 const a=item(4,'ANN00001',{parentID:2,isAttachment:()=>false,isAnnotation:()=>true,annotationType:'highlight',annotationText:'正文内容',annotationPageLabel:'3',annotationSortIndex:'00003'});
 files.set(md.file,Buffer.from('正文内容。\n'));
 const Zotero={Items:{get:id=>items.get(id),getByLibraryAndKey:(lib,key)=>[...items.values()].find(i=>i.libraryID===lib&&i.key===key)},
  Libraries:{get:()=>({editable:true,filesEditable:true})},Sync:{Storage:{Local:{SYNC_STATE_TO_UPLOAD:1}}},
  Notifier:{registerObserver:o=>{observer=o;return 'observer';},unregisterObserver:()=>{observer=null;}},logError:()=>{}};
 const IOUtils={exists:async p=>files.has(p),read:async p=>new Uint8Array(files.get(p)),readJSON:async p=>JSON.parse(files.get(p)),
  writeJSON:async(p,v)=>files.set(p,Buffer.from(JSON.stringify(v))),makeDirectory:async()=>{},copy:async(a,b)=>files.set(b,files.get(a)),
  writeUTF8:async(p,v)=>files.set(p,Buffer.from(v))};
 const app={data:'/data',confirm:()=>true,notify:t=>notifications.push(t)};
 const c=load({Zotero,IOUtils,PathUtils:{join:path.posix.join}}),sync=new c.PDFHelperMarkdownSync(app);
 return {c,sync,Zotero,IOUtils,files,items,pdf,md,a,saved,notifications,app,observer:()=>observer};
}
test('enable, automatic modification and permanent deletion update the same attachment and retain a backup',async()=>{
 const f=fixture();await f.sync.init();await f.sync.enable(f.pdf);
 assert.match(f.files.get('/scan.md').toString(),/<mark data-pdf-helper=/);
 assert.equal(f.files.get('/data/markdown-backups/1-MD000001.md').toString(),'正文内容。\n');
 f.a.annotationText='内容';f.observer().notify('modify','item',[4]);
 await new Promise(r=>setTimeout(r,500));await Promise.all(f.sync.queues.values());
 assert.match(f.files.get('/scan.md').toString(),/正文<mark[^>]+>内容<\/mark>/);
 f.items.delete(4);const get=f.Zotero.Items.get;f.Zotero.Items.get=id=>id===4?false:get(id);f.observer().notify('delete','item',[4]);
 await new Promise(r=>setTimeout(r,500));await Promise.all(f.sync.queues.values());
 assert.equal(f.files.get('/scan.md').toString(),'正文内容。\n');
 assert.equal(f.md.attachmentSyncState,1);assert.ok(f.saved.includes(3));await f.sync.close();
});
test('restart reconciles offline deletion and stop disables later writes',async()=>{
 const f=fixture();await f.sync.init();await f.sync.enable(f.pdf);await f.sync.close();f.a.deleted=true;
 const next=new f.c.PDFHelperMarkdownSync(f.app);await next.init();await next.sync(f.pdf);
 assert.equal(f.files.get('/scan.md').toString(),'正文内容。\n');
 await next.stop(f.pdf);f.a.deleted=false;await next.sync(f.pdf);assert.equal(f.files.get('/scan.md').toString(),'正文内容。\n');await next.close();
});
test('erase notification with a cached tombstone still resolves its original PDF',async()=>{
 const f=fixture();await f.sync.init();await f.sync.enable(f.pdf);f.a.parentID=false;
 f.observer().notify('delete','item',[4]);await new Promise(r=>setTimeout(r,500));await Promise.all(f.sync.queues.values());
 assert.equal(f.files.get('/scan.md').toString(),'正文内容。\n');await f.sync.close();
});
test('a concurrent external edit wins and the first backup remains unchanged',async()=>{
 const f=fixture();await f.sync.init();let reads=0;
 const originalRead=f.IOUtils.read;f.IOUtils.read=async p=>{if(++reads===2)f.files.set(p,Buffer.from('外部刚修改'));return originalRead(p);};
 await assert.rejects(()=>f.sync.enable(f.pdf),/其他程序/);
 assert.equal(f.files.get('/scan.md').toString(),'外部刚修改');assert.equal(Object.keys(f.sync.bindings).length,0);
 await f.sync.close();
});
test('missing files, invalid UTF-8, read-only libraries and changed parent do not overwrite MD',async()=>{
 for(const kind of ['missing','utf8','readonly','moved']){
  const f=fixture();await f.sync.init();const before=f.files.get('/scan.md');
  if(kind==='missing')f.files.delete('/scan.md');
  if(kind==='utf8')f.files.set('/scan.md',Buffer.from([255,254,255]));
  if(kind==='readonly')f.Zotero.Libraries.get=()=>({editable:false,filesEditable:false});
  if(kind==='moved')f.md.parentID=99;
  const expected=f.files.get('/scan.md');
  await assert.rejects(()=>f.sync.enable(f.pdf));assert.equal(f.files.get('/scan.md'),expected);await f.sync.close();
 }
});
test('cancel has no file writes or bindings; one MD cannot be linked to two PDFs',async()=>{
 const f=fixture();await f.sync.init();f.app.confirm=()=>false;await f.sync.enable(f.pdf);
 assert.equal(Object.keys(f.sync.bindings).length,0);assert.equal(f.files.size,1);
 f.app.confirm=()=>true;await f.sync.enable(f.pdf);
 const other={...f.pdf,id:20,key:'PDF00002'};await assert.rejects(()=>f.sync.enable(other),/另一个 PDF/);await f.sync.close();
});
