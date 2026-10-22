'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const root=path.resolve(__dirname,'..');
function fixture(){
 const prefs=new Map([['text.enabled',true],['text.cleanNewHighlights',true],['text.options','{"preset":"paper"}']]);
 const items=new Map(),observers=new Map(),errors=[],saved=[],notices=[],prompts=[],alerts=[];let serial=0,confirmed=true;
 const readers=[{_instanceID:'reader-plain',itemID:10,native:new Map()},{_instanceID:'reader-ocr',itemID:11,native:new Map()}];
 const Zotero={Items:{get:id=>items.get(id),getByLibraryAndKey:(library,key)=>[...items.values()].find(v=>v.libraryID===library&&v.key===key)},
  Reader:{_readers:readers,registerEventListener(){},unregisterEventListener(){}},logError:e=>errors.push(String(e)),
  Notifier:{registerObserver(observer,types){const id=++serial;observers.set(id,observer);return id;},unregisterObserver:id=>observers.delete(id)}};
 const fail=()=>{throw new Error('No OCR/Python/network or attachment receipts allowed');};
 const app={pref:key=>prefs.get(key),setPref:(key,value)=>prefs.set(key,value),ensure:fail,configure:fail,request:fail,notify:t=>notices.push(t),
  confirm:message=>{prompts.push(message);return confirmed;},alert:message=>alerts.push(message)};
 Object.defineProperty(app,'receipts',{get:fail});Object.defineProperty(app,'state',{get:fail});
 const ctx=vm.createContext({Zotero});
 for(const name of ['options','protected','lineBreaks','whitespace','punctuation','index','annotations'])vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/text',name+'.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/textUI.js'),'utf8'),ctx);
 ctx.app=app;const tools=vm.runInContext('new AcademicTextUI(app)',ctx);tools.init();
 for(const id of [10,11])items.set(id,{id,libraryID:1,isAttachment:()=>true,attachmentReaderType:'pdf'});
 const emit=async(event,ids,extra={})=>{for(const observer of observers.values())await observer.notify(event,'item',ids,extra);};
 function annotation(id=20,options={}){
  const item={id,key:'KEY'+id,libraryID:1,parentID:10,annotationType:'highlight',annotationIsExternal:false,deleted:false,
   annotationText:'中国 文学, "史料"如此.',annotationComment:'评论 不变。',annotationColor:'#ffd400',annotationPosition:'{"pageIndex":2,"rects":[[1,2,3,4]]}',
   isAnnotation:()=>true,isEditable:()=>true,...options,
   async saveTx(opts){
    saved.push({id,text:this.annotationText,options:opts});this.persisted=this.annotationText;
    for(const reader of readers)if(reader.itemID===this.parentID&&opts.notifierData?.instanceID!==reader._instanceID)reader.native.set(this.key,this.annotationText);
    await emit('modify',[id],{[id]:opts.notifierData});
   }};item.persisted=item.annotationText;items.set(id,item);return item;
 }
 const add=(item,instance='reader-plain')=>emit('add',[item.id],{[item.id]:{instanceID:instance}});
 return {prefs,items,observers,errors,saved,readers,tools,ctx,annotation,add,emit,notices,prompts,alerts,confirm:value=>confirmed=value};
}
test('ordinary selectable PDF persists cleaned text and native reader receives modify without overlay',async()=>{
 const f=fixture(),item=f.annotation();await f.add(item);
 assert.equal(item.persisted,'中国文学，“史料”如此。');assert.equal(item.annotationText,item.persisted);
 assert.equal(f.readers[0].native.get(item.key),item.persisted);assert.equal(f.saved.length,1);
 assert.equal(f.saved[0].options.notifierData.instanceID,undefined,'originating Reader must not ignore the change');
 assert.equal(item.annotationComment,'评论 不变。');assert.equal(item.annotationColor,'#ffd400');
 assert.equal(item.annotationPosition,'{"pageIndex":2,"rects":[[1,2,3,4]]}');
 assert.equal('originalText' in item,false,'no retained raw excerpt field');
 assert.equal(fs.existsSync(path.join(root,'plugin/content/text/sidebar.js')),false,'overlay module removed');
});
test('PaddleOCR and unrelated normal PDF use same path, with no receipts/helper lookup',async()=>{
 const f=fixture(),plain=f.annotation(),ocr=f.annotation(21,{parentID:11});
 await f.add(plain);await f.add(ocr,'reader-ocr');
 assert.equal(plain.persisted,ocr.persisted);assert.equal(f.saved.length,2);assert.deepEqual(f.errors,[]);
});
test('auto switch off only affects future highlights, never restores previously saved text',async()=>{
 const f=fixture(),first=f.annotation();await f.add(first);const kept=first.persisted;
 f.tools.saveOptions(f.tools.getOptions(),false);const second=f.annotation(21);await f.add(second);
 assert.equal(second.persisted,'中国 文学, "史料"如此.');assert.equal(first.persisted,kept);
 f.tools.saveOptions(f.tools.getOptions(),true);assert.equal(f.saved.length,1,'saving settings does not scan annotations');
});
test('master off and malformed preferences never change new annotations',async()=>{
 for(const mode of ['off','broken']){
  const f=fixture(),item=f.annotation();if(mode==='off')f.prefs.set('text.enabled',false);else f.prefs.set('text.options','{broken');
  await f.add(item);assert.equal(f.saved.length,0);assert.equal(item.persisted,item.annotationText);
 }
});
test('sync/import, absent or foreign Reader origin, external and read-only annotations are not touched',async()=>{
 const f=fixture();
 for(const [n,options,instance] of [[20,{},null],[21,{},'unknown'],[22,{parentID:11},'reader-plain'],
  [23,{annotationIsExternal:true},'reader-plain'],[24,{isEditable:()=>false},'reader-plain'],[25,{deleted:true},'reader-plain']]){
  const item=f.annotation(n,options);await f.add(item,instance);
 }
 assert.equal(f.saved.length,0);
});
test('notifier modifies and old highlights never auto-clean; user edits remain as saved',async()=>{
 const f=fixture(),item=f.annotation();await f.emit('modify',[item.id],{[item.id]:{instanceID:'reader-plain'}});
 assert.equal(f.saved.length,0);await f.add(item);item.annotationText='用户 自己, 编辑.';await item.saveTx({notifierData:{instanceID:'reader-plain'}});
 assert.equal(item.persisted,'用户 自己, 编辑.');assert.equal(f.saved.length,2);
});
test('only PDF highlighter excerpts are changed; comments/images/text notes/EPUB stay untouched',async()=>{
 const f=fixture();for(const [id,type] of [[20,'note'],[21,'image'],[22,'text'],[23,'ink']])await f.add(f.annotation(id,{annotationType:type}));
 f.items.get(10).attachmentReaderType='epub';await f.add(f.annotation(24));assert.equal(f.saved.length,0);
 f.items.get(10).attachmentReaderType='pdf';const under=f.annotation(25,{annotationType:'underline'});await f.add(under);assert.equal(f.saved.length,1);
});
test('duplicate concurrent add notifications save only once and modify does not recurse',async()=>{
 const f=fixture(),item=f.annotation();let release;item.saveTx=async function(opts){f.saved.push(opts);await new Promise(r=>release=r);this.persisted=this.annotationText;};
 const first=f.add(item),second=f.add(item);await second;assert.equal(f.saved.length,1);release();await first;
 assert.equal(item.persisted,'中国文学，“史料”如此。');assert.equal(f.tools.annotations.pending.size,0);
});
test('local process failure leaves the successfully created highlight untouched',async()=>{
 const f=fixture(),item=f.annotation();vm.runInContext('AcademicText.cleanAcademicText=()=>{throw new Error("sensitive excerpt")}',f.ctx);
 await assert.doesNotReject(f.add(item));assert.equal(f.saved.length,0);assert.equal(item.persisted,item.annotationText);
 assert.ok(f.errors.every(s=>!s.includes('sensitive excerpt')));
});
test('failed annotation save restores cached original and does not lose the existing database value',async()=>{
 const f=fixture(),item=f.annotation(),before=item.persisted;item.saveTx=async()=>{throw new Error('save failed');};
 await assert.doesNotReject(f.add(item));assert.equal(item.annotationText,before);assert.equal(item.persisted,before);assert.ok(f.errors.length);
});
test('failed save cannot overwrite a newer manual edit',async()=>{
 const f=fixture(),item=f.annotation();item.saveTx=async()=>{item.annotationText='新的 手工编辑';throw new Error('fixture');};
 await f.add(item);assert.equal(item.annotationText,'新的 手工编辑');
});
test('unchanged or empty cleanup results never generate writes',async()=>{
 const f=fixture();await f.add(f.annotation(20,{annotationText:'中国文学。'}));await f.add(f.annotation(21,{annotationText:'   '}));
 f.tools.annotations.process=()=>'';await f.add(f.annotation(22));assert.equal(f.saved.length,0);
});
test('new rules apply to future highlights, not to a previously persisted excerpt',async()=>{
 const f=fixture(),first=f.annotation();await f.add(first);f.tools.saveOptions({preset:'custom',punctuation:'english'},true);
 const second=f.annotation(21);await f.add(second);assert.equal(first.persisted,'中国文学，“史料”如此。');assert.equal(second.persisted,'中国文学, "史料"如此.');
});
test('shutdown unregisters observer and waits for outstanding saves',async()=>{
 const f=fixture(),item=f.annotation();let release,closed=false;item.saveTx=async()=>new Promise(r=>release=r);
 const saving=f.add(item),closing=f.tools.shutdown().then(()=>closed=true);assert.equal(f.observers.size,0);
 await Promise.resolve();assert.equal(closed,false);release();await saving;await closing;assert.equal(closed,true);
 await f.tools.annotations.notify('add','item',[item.id],{[item.id]:{instanceID:'reader-plain'}});assert.equal(f.saved.length,0);
});
test('manual action saves only unique selected editable highlights, including old normal PDFs with auto off',async()=>{
 const f=fixture(),selected=f.annotation(),untouched=f.annotation(21),underline=f.annotation(22,{annotationType:'underline'});
 f.prefs.set('text.cleanNewHighlights',false);
 const result=await f.tools.saveSelected(f.readers[0],[selected.key,selected.id,underline.key]);
 assert.deepEqual({...result},{saved:2,unchanged:0,skipped:0,failed:0});assert.equal(f.saved.length,2);
 assert.equal(untouched.persisted,'中国 文学, "史料"如此.');assert.equal(selected.annotationComment,'评论 不变。');
 assert.equal(f.prompts.length,1);assert.ok(f.prompts[0].includes('2 条'));assert.ok(f.notices[0].includes('已保存 2 条'));
});
test('manual save cancellation is read-only and uses rules current at click time',async()=>{
 const f=fixture(),item=f.annotation();f.confirm(false);await f.tools.saveSelected(f.readers[0],[item.key]);
 assert.equal(f.saved.length,0);assert.equal(f.notices.length,0);
 f.confirm(true);f.tools.saveOptions({punctuation:'english'},false);await f.tools.saveSelected(f.readers[0],[item.key]);
 assert.equal(item.persisted,'中国文学, "史料"如此.');
});
test('manual save skips external, foreign PDF/library, deleted, comment, read-only and unknown annotations',async()=>{
 const f=fixture();
 const entries=[f.annotation(20,{annotationIsExternal:true}),f.annotation(21,{parentID:11}),
  f.annotation(22,{libraryID:2}),f.annotation(23,{deleted:true}),f.annotation(24,{annotationType:'note'}),
  f.annotation(25,{isEditable:()=>false})];
 await f.tools.saveSelected(f.readers[0],[...entries.map(item=>item.id),'UNKNOWN']);
 assert.equal(f.saved.length,0);assert.equal(f.prompts.length,0);assert.equal(f.alerts.length,1);
});
test('master off and corrupt settings block manual writes before confirmation',async()=>{
 for(const kind of ['off','corrupt']){
  const f=fixture(),item=f.annotation();f.prefs.set(kind==='off'?'text.enabled':'text.options',kind==='off'?false:'{broken');
  await f.tools.saveSelected(f.readers[0],[item.key]);assert.equal(f.saved.length,0);assert.equal(f.prompts.length,0);assert.equal(f.alerts.length,1);
 }
});
test('manual batch reports unchanged and failure and continues to later selected items',async()=>{
 const f=fixture(),same=f.annotation(20,{annotationText:'中国文学。'}),bad=f.annotation(21),good=f.annotation(22);
 const before=bad.persisted;bad.saveTx=async()=>{throw new Error('private excerpt');};
 const result=await f.tools.saveSelected(f.readers[0],[same.key,bad.key,good.key]);
 assert.deepEqual({...result},{saved:1,unchanged:1,skipped:0,failed:1});assert.equal(bad.annotationText,before);
 assert.equal(good.persisted,'中国文学，“史料”如此。');assert.ok(f.errors.every(s=>!s.includes('private excerpt')));
});
test('manual batch does not overwrite a later user edit and shutdown waits for manual saves',async()=>{
 const f=fixture(),first=f.annotation(),later=f.annotation(21);let release,closed=false;
 first.saveTx=async function(){await new Promise(r=>release=r);this.persisted=this.annotationText;};
 const task=f.tools.saveSelected(f.readers[0],[first.id,later.id]);later.annotationText='手工 修改';
 const closing=f.tools.shutdown().then(()=>closed=true);await Promise.resolve();assert.equal(closed,false);
 release();const result=await task;await closing;assert.equal(result.saved,1);assert.equal(result.skipped,1);
 assert.equal(later.annotationText,'手工 修改');assert.equal(f.tools.annotations.pending.size,0);
});
test('fresh highlights and manual old highlights both use Unicode and Chinese-quote fixes',async()=>{
 const f=fixture(),fresh=f.annotation(20,{annotationText:'制造 “碎片化” 与 “整体化” 的对立,洪\u2009子诚。'});
 await f.add(fresh);assert.equal(fresh.persisted,'制造“碎片化”与“整体化”的对立，洪子诚。');
 const old=f.annotation(21,{annotationText:'制造 “碎片化”与 “整体化”的对立。'});
 const result=await f.tools.saveSelected(f.readers[0],[old.key]);assert.equal(result.saved,1);
 assert.equal(old.persisted,'制造“碎片化”与“整体化”的对立。');
});
test('manual batch snapshot protects a later hand edit even while the plugin remains active',async()=>{
 const f=fixture(),first=f.annotation(),later=f.annotation(21);let release;
 first.saveTx=async function(){await new Promise(r=>release=r);this.persisted=this.annotationText;};
 const task=f.tools.saveSelected(f.readers[0],[first.id,later.id]);later.annotationText='用户 自己编辑';release();
 const result=await task;assert.equal(result.saved,1);assert.equal(result.skipped,1);
 assert.equal(later.annotationText,'用户 自己编辑');assert.equal(f.tools.annotations.closed,false);
});
test('manual process failure reports failure, leaves text untouched and never logs the excerpt',async()=>{
 const f=fixture(),item=f.annotation(),original=item.annotationText;
 vm.runInContext('AcademicText.cleanAcademicText=()=>{throw new Error("private excerpt")}',f.ctx);
 const result=await f.tools.saveSelected(f.readers[0],[item.id]);assert.equal(result.failed,1);
 assert.equal(item.annotationText,original);assert.equal(f.saved.length,0);assert.ok(f.notices[0].includes('保存失败 1 条'));
 assert.ok(f.errors.every(s=>!s.includes('private excerpt')));
});
test('one manual batch uses the saved rules captured at command time even if settings change later',async()=>{
 const f=fixture(),first=f.annotation(),later=f.annotation(21);let release;
 first.saveTx=async function(){await new Promise(r=>release=r);this.persisted=this.annotationText;};
 const task=f.tools.saveSelected(f.readers[0],[first.id,later.id]);f.tools.saveOptions({punctuation:'english'},false);release();
 const result=await task;assert.equal(result.saved,2);assert.equal(first.persisted,'中国文学，“史料”如此。');
 assert.equal(later.persisted,first.persisted);assert.equal(f.tools.getOptions().punctuation,'english');
});
