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
  getField:()=>v.title||v.attachmentFilename||'',isLinkedFileAttachment:()=>false,getFilePathAsync:async()=>v.file,
  saveTx:async options=>{saved.push(id);observer?.notify('modify','item',[id],{[id]:options?.notifierData});},...fields};items.set(id,v);return v;};
 const document=(id,key)=>item(id,key,{isAttachment:()=>false,getAttachments:()=>[...items.values()].filter(i=>i.parentID===id&&i.isAttachment()&&!i.deleted).map(i=>i.id)});
 const parent=document(1,'PARENT01');
 function book(id,name){
  const p=document(id,'PARENT'+id),pdf=item(id+1,'PDF'+String(id).padStart(5,'0'),{parentID:id,attachmentReaderType:'pdf',attachmentFilename:name+'.pdf',getAnnotations:()=>[...items.values()].filter(i=>i.parentID===id+1&&!i.deleted)});
  const md=item(id+2,'MD'+String(id).padStart(6,'0'),{parentID:id,attachmentFilename:name+'.ocr.md',file:'/'+name+'.md'});
  const a=item(id+3,'ANN'+String(id).padStart(5,'0'),{parentID:pdf.id,isAttachment:()=>false,isAnnotation:()=>true,annotationType:'highlight',annotationText:'正文内容',annotationPageLabel:'3',annotationSortIndex:'00003'});
  files.set(md.file,Buffer.from('正文内容。\n'));return {parent:p,pdf,md,a};
 }
 items.delete(1);const first=book(1,'scan');
 const libraries=new Map([[1,{libraryID:1,editable:true,filesEditable:true}]]);
 const Zotero={Items:{get:id=>items.get(id)||false,getAsync:async ids=>Array.isArray(ids)?ids.map(id=>items.get(id)||false):items.get(ids)||false,
  getAll:async lib=>[...items.values()].filter(i=>i.libraryID===lib&&!i.deleted),getByLibraryAndKey:(lib,key)=>[...items.values()].find(i=>i.libraryID===lib&&i.key===key)||false},
  Libraries:{get:id=>libraries.get(id),getAll:()=>[...libraries.values()]},Sync:{Storage:{Local:{SYNC_STATE_TO_UPLOAD:1}}},
  Notifier:{registerObserver:o=>{observer=o;return 'observer';},unregisterObserver:()=>{observer=null;}},logError:()=>{}};
 const IOUtils={exists:async p=>files.has(p),read:async p=>new Uint8Array(files.get(p)),readJSON:async p=>JSON.parse(files.get(p)),
  writeJSON:async(p,v)=>files.set(p,Buffer.from(JSON.stringify(v))),makeDirectory:async()=>{},copy:async(a,b)=>files.set(b,files.get(a)),
  writeUTF8:async(p,v)=>files.set(p,Buffer.from(v))};
 const app={data:'/data',notify:t=>notifications.push(t)};
 const c=load({Zotero,IOUtils,PathUtils:{join:path.posix.join}}),sync=new c.PDFHelperMarkdownSync(app);
 return {c,sync,Zotero,IOUtils,files,items,libraries,...first,saved,notifications,app,item,book,observer:()=>observer};
}
const drain=async f=>{await f.sync.scanPromise;await new Promise(r=>setTimeout(r,500));await Promise.all(f.sync.queues.values());};
test('one global switch backfills all documents, persists state, and excludes Zotero notes and annotations as files',async()=>{
 const f=fixture(),second=f.book(10,'other');
 f.item(20,'NOTEMD01',{parentID:1,attachmentFilename:'scan.md',isAttachment:()=>false,file:'/note.md'});
 f.files.set('/note.md',Buffer.from('笔记不是附件'));
 await f.sync.init();assert.equal(f.sync.enabled,false);assert.equal(f.saved.length,0);
 await f.sync.setEnabled(true);await f.sync.scanPromise;
 for(const md of [f.md,second.md])assert.match(f.files.get(md.file).toString(),/<mark data-pdf-helper=/);
 assert.equal(f.files.get('/note.md').toString(),'笔记不是附件');assert.equal(f.sync.status.synced,2);
 const state=JSON.parse(f.files.get('/data/markdown-highlights.json'));assert.equal(state.schema,2);assert.equal(state.enabled,true);
 assert.equal(f.files.get('/data/markdown-backups/1-'+f.md.key+'.md').toString(),'正文内容。\n');await f.sync.close();
});
test('title and filename matching supports similar names and multiple PDFs without a selector',()=>{
 const f=fixture(),match=f.c.PDFHelperMarkdown.matchAttachment;
 f.pdf.title='考文叙事录（解志熙）';f.md.attachmentFilename='result.md';f.md.title='考文叙事录 解志熙 - OCR';
 assert.equal(match(f.pdf,[f.pdf,f.md]),f.md);
 f.pdf.title='中国现代文学史料学';f.pdf.attachmentFilename='book.pdf';f.md.title='中国现代文学史料学 文字层';assert.equal(match(f.pdf,[f.pdf,f.md]),f.md);
 f.pdf.title='中国现代文学史料学 (z-library.sk, 1lib.sk, z-lib.sk)';f.md.title='中国现代文学史料学';assert.equal(match(f.pdf,[f.pdf,f.md]),f.md);
 f.md.title='中国现代文学史料论';assert.equal(match(f.pdf,[f.pdf,f.md]),f.md);
 const other=f.item(30,'PDF00030',{parentID:1,attachmentReaderType:'pdf',attachmentFilename:'第二卷.pdf'});
 const otherMD=f.item(31,'MD000030',{parentID:1,attachmentFilename:'第二卷.md'});
 assert.equal(match(other,[f.pdf,f.md,other,otherMD]),otherMD);
 const note={...otherMD,isAttachment:()=>false};assert.equal(match(other,[other,note]),null);
});
test('a missing or tied title match is skipped without prompting',()=>{
 const f=fixture(),match=f.c.PDFHelperMarkdown.matchAttachment;
 f.md.attachmentFilename='完全不同的附件.md';assert.equal(match(f.pdf,[f.pdf,f.md]),null);
 f.md.attachmentFilename='scan.md';const duplicate={...f.md,id:99,key:'MD000099'};
 assert.equal(match(f.pdf,[f.pdf,f.md,duplicate]),null);
});
test('schema 1 pairs migrate to global mode and preserve an existing explicit relationship',async()=>{
 const f=fixture();f.md.attachmentFilename='previous-choice.md';
 f.files.set('/data/markdown-highlights.json',Buffer.from(JSON.stringify({schema:1,bindings:{['1:'+f.pdf.key]:{libraryID:1,pdfKey:f.pdf.key,mdKey:f.md.key}}})));
 await f.sync.init();await f.sync.scanPromise;assert.equal(f.sync.enabled,true);assert.match(f.files.get(f.md.file).toString(),/<mark data-/);
 assert.equal(JSON.parse(f.files.get('/data/markdown-highlights.json')).schema,2);await f.sync.close();
});
test('modification and permanent deletion automatically update files without a per-PDF setup',async()=>{
 const f=fixture();await f.sync.init();await f.sync.setEnabled(true);await f.sync.scanPromise;
 f.a.annotationText='内容';f.observer().notify('modify','item',[f.a.id]);await drain(f);
 assert.match(f.files.get(f.md.file).toString(),/正文<mark[^>]+>内容<\/mark>/);
 const id=f.a.id;f.items.delete(id);f.observer().notify('delete','item',[id]);await drain(f);
 assert.equal(f.files.get(f.md.file).toString(),'正文内容。\n');assert.equal(f.md.attachmentSyncState,1);await f.sync.close();
});
test('global off stops all documents and global on reconciles changes made while off',async()=>{
 const f=fixture(),second=f.book(10,'other');await f.sync.init();await f.sync.setEnabled(true);await f.sync.scanPromise;
 const before=f.files.get(f.md.file).toString();await f.sync.setEnabled(false);
 f.a.annotationText='内容';second.a.deleted=true;f.observer().notify('modify','item',[f.a.id,second.a.id]);await drain(f);
 assert.equal(f.files.get(f.md.file).toString(),before);
 await f.sync.setEnabled(true);await f.sync.scanPromise;assert.match(f.files.get(f.md.file).toString(),/正文<mark[^>]+>内容/);
 assert.equal(f.files.get(second.md.file).toString(),'正文内容。\n');await f.sync.close();
});
test('a newly added matching MD automatically synchronizes a previously unmatched document',async()=>{
 const f=fixture();f.items.delete(f.md.id);await f.sync.init();await f.sync.setEnabled(true);await f.sync.scanPromise;
 assert.equal(f.sync.status.skipped,1);f.items.set(f.md.id,f.md);f.observer().notify('add','item',[f.md.id]);await drain(f);
 assert.match(f.files.get(f.md.file).toString(),/<mark data-/);await f.sync.close();
});
test('startup reconciles offline deletion and keeps a saved global off switch off',async()=>{
 const f=fixture();await f.sync.init();await f.sync.setEnabled(true);await f.sync.scanPromise;await f.sync.close();f.a.deleted=true;
 const next=new f.c.PDFHelperMarkdownSync(f.app);await next.init();await next.scanPromise;
 assert.equal(f.files.get(f.md.file).toString(),'正文内容。\n');await next.setEnabled(false);await next.close();
 const off=new f.c.PDFHelperMarkdownSync(f.app);await off.init();assert.equal(off.enabled,false);assert.equal(off.scanPromise,undefined);await off.close();
});
test('a later file download synchronizes an already-known MD without asking for a new pairing',async()=>{
 const f=fixture();f.files.delete(f.md.file);await f.sync.init();await f.sync.setEnabled(true);await f.sync.scanPromise;
 f.files.set(f.md.file,Buffer.from('正文内容。\n'));f.observer().notify('download','file',[f.md.id]);await drain(f);
 assert.match(f.files.get(f.md.file).toString(),/<mark data-/);await f.sync.close();
});
test('switching off during a pending read prevents the pending write',async()=>{
 const f=fixture();await f.sync.init();let unblock,entered;
 const gate=new Promise(r=>unblock=r),ready=new Promise(r=>entered=r),read=f.IOUtils.read;
 f.IOUtils.read=async p=>{entered();await gate;return read(p);};
 await f.sync.setEnabled(true);await ready;await f.sync.setEnabled(false);unblock();await f.sync.scanPromise;
 assert.equal(f.files.get(f.md.file).toString(),'正文内容。\n');await f.sync.close();
});
test('a concurrent external edit wins, and one failed document does not stop others',async()=>{
 const f=fixture(),second=f.book(10,'other');await f.sync.init();let reads=0;const read=f.IOUtils.read;
 f.IOUtils.read=async p=>{if(p===f.md.file&&++reads===2)f.files.set(p,Buffer.from('外部刚修改'));return read(p);};
 await f.sync.setEnabled(true);await f.sync.scanPromise;
 assert.equal(f.files.get(f.md.file).toString(),'外部刚修改');assert.match(f.files.get(second.md.file).toString(),/<mark data-/);
 assert.equal(f.sync.status.failed,1);assert.equal(f.sync.status.synced,1);await f.sync.close();
});
test('undownloaded MDs and read-only libraries are skipped and own save notifications do not loop',async()=>{
 const f=fixture();f.files.delete(f.md.file);f.libraries.set(2,{libraryID:2,editable:false,filesEditable:false});
 const getAll=f.Zotero.Items.getAll;f.Zotero.Items.getAll=async lib=>{assert.notEqual(lib,2);return getAll(lib);};
 await f.sync.init();await f.sync.setEnabled(true);await f.sync.scanPromise;assert.equal(f.sync.status.skipped,1);assert.equal(f.sync.timers.size,0);
 f.files.set(f.md.file,Buffer.from('正文内容。\n'));await f.sync.sync(f.pdf);assert.equal(f.sync.timers.size,0);await f.sync.close();
});
test('a failed stored-file sync flag is retried without losing the file backup',async()=>{
 const f=fixture();await f.sync.init();let fail=true;f.md.saveTx=async()=>{if(fail)throw Error('DB busy');f.saved.push(f.md.id);};
 await f.sync.setEnabled(true);await f.sync.scanPromise;assert.equal(f.sync.status.failed,1);fail=false;
 await f.sync.sync(f.pdf);assert.ok(f.saved.includes(f.md.id));assert.equal(f.files.get('/data/markdown-backups/1-'+f.md.key+'.md').toString(),'正文内容。\n');await f.sync.close();
});
