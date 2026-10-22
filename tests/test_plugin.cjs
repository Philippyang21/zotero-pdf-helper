'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function fixture(){
 const items=new Map(),files=new Map(),collections=[];let seq=10;
 class Item {
  constructor(type){this.type=type;this.libraryID=1;this.fields={};this.related=[];}
  getField(key){return this.fields[key]||'';} setField(key,v){this.fields[key]=v;}
  getCreators(){return this.creators||[];} setCreators(value){this.creators=value;}
  getAttachments(){return [...items.values()].filter(i=>i.parentID===this.id&&!i.deleted).map(i=>i.id);}
  async getFilePathAsync(){return this.file;} isLinkedFileAttachment(){return !!this.linked;}
  setCollections(ids){this.collections=ids;} addRelatedItem(item){if(!this.related.includes(item.id))this.related.push(item.id);}
  async save(){this.id||=++seq;this.key||='KEY'+this.id;items.set(this.id,this);return this.id;}
  async saveTx(){return this.save();}
 }
 class Collection {async save(){this.id=collections.length+1;collections.push(this);return this.id;}}
 class Search {constructor(){this.conditions=[];}addCondition(...args){this.conditions.push(args);}async search(){return [...items.values()].filter(i=>i.libraryID===this.libraryID&&this.conditions.every(([k,o,v])=>k==='itemType'?i.type===v:i.getField(k).includes(v))).map(i=>i.id);}}
 function make(id,type,fields={}){const item=new Item(type);Object.assign(item,{id,key:'KEY'+id,itemTypeID:type==='book'?2:14},fields);items.set(id,item);return item;}
 const parent=make(1,'book');
 const pdf=make(2,'attachment',{parentID:1,attachmentFilename:'scan.pdf',file:'C:\\library\\scan.pdf'});
 const md=make(3,'attachment',{parentID:1,attachmentFilename:'scan.md',file:'C:\\library\\scan.md'});
 const json=make(4,'attachment',{parentID:1,attachmentFilename:'scan.json',file:'C:\\library\\scan.json'});
 const other=make(5,'attachment',{parentID:1,attachmentFilename:'notes.md',file:'C:\\library\\notes.md'});
 const job={id:'job-one',state:'done',mode:'merge',pages:4,target:pdf.file,parent:1,attachment:{id:2,key:'KEY2',libraryID:1},md:'C:\\data\\result.md',json:'C:\\data\\result.json',sha256:'source',sourceHash:'source',outputHash:'output',sidecars:'archive'};
 for(const p of [md.file,job.md])files.set(p,'markdown');for(const p of [json.file,job.json])files.set(p,'json');files.set(other.file,'unrelated');files.set(pdf.file,'pdf');
 const Zotero={Item,Collection,Search,Profile:{dir:'C:\\profile'},Collections:{getByLibrary:()=>collections},DB:{executeTransaction:async fn=>fn()},
  Items:{get:id=>items.get(id),getAsync:async id=>items.get(id)},Libraries:{get:()=>({editable:true,filesEditable:true})},
  Utilities:{Internal:{md5Async:async file=>{if(!files.has(file))throw new Error('missing file');return crypto.createHash('md5').update(files.get(file)).digest('hex');}}},
  Prefs:{get:()=> 'archive'},Attachments:{},
  ItemFields:{getID:name=>name,isValidForType:(name,type)=>type===2&&['title','volume','numberOfVolumes','edition','date','publisher','place'].includes(name)},
  CreatorTypes:{getID:name=>name==='author'?1:0}};
 async function importFile({file,parentItemID,libraryID,title}){const i=new Item('attachment');i.parentID=parentItemID;i.libraryID=libraryID;i.attachmentFilename=path.win32.basename(file);i.file=file;i.title=title;await i.save();return i;}
 Zotero.Attachments.importFromFile=importFile;Zotero.Attachments.linkFromFile=async opts=>{const i=await importFile(opts);i.linked=true;return i;};
 const ctx=vm.createContext({Zotero,PathUtils:{join:path.win32.join,filename:path.win32.basename,parent:path.win32.dirname},IOUtils:{exists:async p=>files.has(p),makeDirectory:async()=>{},copy:async(a,b)=>files.set(b,files.get(a)),writeJSON:async()=>{}},setInterval,clearInterval});
 vm.runInContext(fs.readFileSync(path.join(root,'plugin/repair.js'),'utf8'),ctx);
 const app=vm.runInContext('new PDFRepair({})',ctx);app.receipts={};app.receiptsPath='C:\\data\\receipts.json';app.notify=()=>{};
 return {app,items,files,collections,parent,pdf,md,json,other,job};
}
test('archive reparents exact stored files, preserves PDF and unrelated files, and recovers without receipt',async()=>{
 const f=fixture();await f.app.ensureSidecars(f.job,f.pdf,'archive');
 const a=await f.app.findArchive(f.pdf);assert.ok(a);assert.equal(f.md.parentID,a.id);assert.equal(f.json.parentID,a.id);
 assert.equal(f.pdf.parentID,1);assert.equal(f.other.parentID,1);assert.equal(f.items.size,6);assert.equal(f.collections.length,1);
 assert.ok(f.parent.related.includes(a.id));assert.ok(a.related.includes(1));
 f.app.receipts={};await f.app.ensureSidecars(f.job,f.pdf,'archive');assert.equal(f.items.size,6);
 const pair=await f.app.matching(f.pdf,f.pdf.file,null,true,'source');assert.equal(pair.md,f.md.file);assert.equal(pair.json,f.json.file);
 await f.app.ensureSidecars(f.job,f.pdf,'import');assert.equal(f.md.parentID,1);assert.equal(f.json.parentID,1);assert.equal(f.items.size,6);
});
test('hidden storage adds no attachments and saved results can be reused',async()=>{
 const f=fixture();await f.app.ensureSidecars(f.job,f.pdf,'hidden');assert.equal(f.items.size,5);assert.equal(f.app.receipts[f.job.id].storage,'hidden');
 f.app.state.jobs=[f.job];const pair=await f.app.matching(f.pdf,f.pdf.file,null,true,'output');assert.equal(pair.json,f.job.json);
 assert.equal(await f.app.copyrightJSON(f.pdf,f.pdf.file,null,'output'),f.job.json);
});
test('archive stores new results and repeated actions do not duplicate files',async()=>{
 const f=fixture();f.items.delete(3);f.items.delete(4);await f.app.ensureSidecars(f.job,f.pdf,'archive');
 const a=await f.app.findArchive(f.pdf);assert.equal(a.getAttachments().length,2);assert.equal(f.parent.getAttachments().length,2);
 const count=f.items.size;await f.app.ensureSidecars(f.job,f.pdf,'archive');assert.equal(f.items.size,count);
 f.files.delete(f.items.get(a.getAttachments()[0]).file);
 await assert.rejects(()=>f.app.matching(f.pdf,f.pdf.file,null,false,'source'),/尚未下载|丢失/);
});
test('archive does not move hash mismatches or linked files',async()=>{
 const f=fixture();f.files.set(f.md.file,'different');await f.app.ensureSidecars(f.job,f.pdf,'archive');assert.equal(f.md.parentID,1);
 const g=fixture();g.md.linked=true;await assert.rejects(()=>g.app.ensureSidecars(g.job,g.pdf,'archive'),/链接附件/);assert.equal(g.md.parentID,1);
});
test('copyright metadata fills only blank supported fields and preserves existing authors',()=>{
 const f=fixture();f.parent.setField('title','已有标题');f.parent.setCreators([{firstName:'',lastName:'原作者',fieldMode:1,creatorTypeID:1}]);
 const changed=f.app.applyCopyrightMetadata(f.parent,{title:'识别标题',authors:['新作者'],volume:'第三卷',numberOfVolumes:'4',edition:'第2版',date:'2020',publisher:'学术出版社',place:'上海'});
 assert.equal(f.parent.getField('title'),'已有标题');assert.equal(f.parent.getField('volume'),'第三卷');
 assert.equal(f.parent.getField('publisher'),'学术出版社');assert.deepEqual(f.parent.getCreators().map(v=>v.lastName),['原作者']);
 assert.ok(changed.applied.includes('卷次'));assert.ok(changed.skipped.includes('标题（已有内容）'));assert.ok(changed.skipped.includes('作者（已有内容）'));
});
test('phase counts do not claim completion before final acknowledgement',()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/progress.js'),'utf8'),ctx);const view=vm.runInContext('RepairProgress.view',ctx);
 const job={state:'generating',pages:1392,progress:{stage:'writing',completed:696,total:1392}};
 assert.equal(view(job).value,50);assert.equal(view(job).tone,'active');
 job.progress.stage='saving';assert.equal(view(job).value,null);
 job.state='recognizing';job.progress={stage:'remote',completed:0};assert.equal(view(job).value,null);
 job.state='done';assert.equal(view(job).value,100);assert.equal(view(job).tone,'success');
 assert.equal(view(job,null,'failed to finalize').tone,'error');
 job.indexPending=true;assert.match(view(job).text,/索引待重建/);job.restored=true;assert.match(view(job).label,/恢复/);
 job.state='retained';job.restored=false;assert.match(view(job).text,/尚未替换/);
});
test('cloud progress distinguishes parsed pages from downloaded results and final completion',()=>{
 const ctx=vm.createContext({Date});vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/progress.js'),'utf8'),ctx);
 const p=vm.runInContext('RepairProgress',ctx);
 const job={state:'recognizing',pages:654,progress:{stage:'remote',completed:200,resultPages:163,known:true},parts:[
  {start:0,end:163,state:'done'},
  {start:163,end:327,state:'accepted',phase:'running',remoteProgress:{completed:37,total:164},lastChecked:new Date().toISOString()},
  {start:327,end:490,state:'accepted',phase:'pending'},
  {start:490,end:654,state:'new'}
 ]};
 assert.equal(p.view(job).value,30.5);assert.match(p.view(job).text,/至少 200 \/ 654/);
 assert.match(p.view(job).text,/已下载 163 页/);assert.match(p.view(job).label,/第 2\/4 段：云端解析中/);
 assert.match(p.view(job).label,/第 3\/4 段：云端排队中/);
 assert.equal(p.segments(job)[1].text,'37 / 164 页');assert.equal(p.segments(job)[3].text,'尚未提交');
 job.progress.completed=654;job.parts.forEach(s=>s.state='done');assert.equal(p.view(job).value,100);assert.equal(p.view(job).tone,'active');
 job.state='done';assert.equal(p.view(job).tone,'success');
 job.state='paused';assert.equal(p.view(job).value,null);
});
test('missing cloud counts stay indeterminate and per-phase timing is readable',()=>{
 const ctx=vm.createContext({Date});vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/progress.js'),'utf8'),ctx);
 const p=vm.runInContext('RepairProgress',ctx);
 const job={state:'recognizing',pages:4,progress:{stage:'remote',known:false,completed:0,resultPages:0},parts:[{start:0,end:4,state:'accepted',phase:'pending',timing:{uploading:5,pending:66,running:120,downloading:3}}],apiSeconds:130,pdfSeconds:7};
 assert.equal(p.view(job).value,null);assert.match(p.view(job).text,/正在等待云端页数/);
 assert.match(p.timing(job),/排队 1 分 6 秒/);assert.match(p.timing(job),/云端流程用时 2 分 10 秒/);
 assert.match(p.segments(job)[0].text,/未返回页数/);assert.equal(p.duration(3661),'1 小时 1 分');
});
function macPythonFixture({configured='',existing=[],envPath='/usr/bin:/bin'}={}){
 const files=new Set(existing);
 const Zotero={isWin:false,isMac:true,Profile:{dir:'/Users/test/Library/Application Support/Zotero/Profiles/test'},Prefs:{get:()=>configured}};
 const Services={env:{get:key=>key==='PATH'?envPath:''},dirsvc:{get:()=>({path:'/Users/test'})}};
 const PathUtils={join:path.posix.join,filename:path.posix.basename,parent:path.posix.dirname};
 const IOUtils={exists:async value=>files.has(value),getChildren:async root=>[...files].filter(value=>path.posix.dirname(value)===root)};
 const ctx=vm.createContext({Zotero,Services,PathUtils,IOUtils,Ci:{nsIFile:{}},setInterval,clearInterval});
 vm.runInContext(fs.readFileSync(path.join(root,'plugin/repair.js'),'utf8'),ctx);
 return vm.runInContext('new PDFRepair({})',ctx);
}
test('macOS Python detection does not depend on Finder PATH',async()=>{
 const app=macPythonFixture({existing:['/opt/homebrew/bin/python3','/usr/bin/python3']});
 assert.equal(await app.findPython(),'/opt/homebrew/bin/python3');
});
test('macOS configured Python expands the user home directory',async()=>{
 const app=macPythonFixture({configured:'~/miniforge3/bin/python3',existing:['/Users/test/miniforge3/bin/python3']});
 assert.equal(await app.findPython(),'/Users/test/miniforge3/bin/python3');
});
