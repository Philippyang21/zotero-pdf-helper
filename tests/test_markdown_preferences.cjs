'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function fixture({selected=true,bound=false,ready=true,textEnabled=false,activeReader=false,standalone=false}={}){
 const nodes=new Map(),items=new Map(),calls=[];
 function node(){return {dataset:{},value:'',textContent:'',disabled:false,children:[],listeners:{},replaceChildren(){this.children=[];this.value='';},appendChild(n){this.children.push(n);},addEventListener(type,fn){this.listeners[type]=fn;}};}
 for(const id of ['settings','pdf','md','refresh','enable','now','stop','status'])nodes.set('markdown-sync-'+id,node());
 const pdf={id:2,key:'PDF00001',libraryID:1,parentID:standalone?false:1,attachmentFilename:'scan.pdf',attachmentReaderType:'pdf',isAttachment:()=>true};
 const md={id:3,key:'MD000001',libraryID:1,parentID:1,attachmentFilename:'scan.md'};
 items.set(1,{getAttachments:()=>[2,3,4]});items.set(2,pdf);items.set(3,md);
 items.set(4,{id:4,key:'MD000002',libraryID:1,parentID:1,attachmentFilename:'notes.md'});
 const binding={libraryID:1,pdfKey:pdf.key,mdKey:md.key};
 const sync={ready,bindings:bound?{'1:PDF00001':binding}:{},key:i=>i.libraryID+':'+i.key,pdf:()=>pdf,
  async enable(p,w,m){calls.push(['enable',p,w,m]);this.bindings[this.key(p)]={...binding,mdKey:m.key};return true;},
  async sync(p){calls.push(['sync',p]);return {total:4,matched:3};},async stop(p){calls.push(['stop',p]);delete this.bindings[this.key(p)];}};
 const mainWindow=activeReader?{Zotero_Tabs:{selectedID:'reader-tab'}}:{},settingsWindow={};let selection=selected?[pdf]:[];
 const app={markdownSync:sync,selected:()=>selection,pref:()=>textEnabled};
 const Zotero={PaddleOCRRepair:app,getMainWindow:()=>mainWindow,Items:{get:id=>{if(!id)throw Error('Invalid item ID');return items.get(id);}},Reader:{getByTabID:tab=>tab==='reader-tab'?{itemID:pdf.id}:null}};
 const document={getElementById:id=>nodes.get(id),createElementNS:(ns,name)=>{assert.equal(ns,'http://www.w3.org/1999/xhtml');assert.equal(name,'option');return node();}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'plugin/content/markdownPreferences.js'),'utf8'),{Zotero,document,window:settingsWindow,setTimeout});
 const el=id=>nodes.get('markdown-sync-'+id);
 return {el,items,pdf,md,sync,calls,settingsWindow,mainWindow,setSelected:v=>selection=v};
}
test('settings enable explicit PDF/MD pair and do not depend on text cleanup being enabled',async()=>{
 const f=fixture();assert.equal(f.el('pdf').value,'1:PDF00001');assert.equal(f.el('md').value,'MD000001');assert.equal(f.el('enable').disabled,false);
 await f.el('enable').listeners.click();assert.equal(f.calls[0][0],'enable');assert.equal(f.calls[0][1],f.pdf);assert.equal(f.calls[0][2],f.settingsWindow);assert.equal(f.calls[0][3],f.md);
 assert.equal(f.el('now').disabled,false);assert.match(f.el('status').textContent,/已开启/);
});
test('existing binding remains visible without a selection and can sync and stop in settings',async()=>{
 const f=fixture({selected:false,bound:true});assert.equal(f.el('md').value,'MD000001');assert.equal(f.el('stop').disabled,false);
 await f.el('now').listeners.click();assert.match(f.el('status').textContent,/4 条摘录.*3 条/);
 await f.el('stop').listeners.click();assert.equal(Object.keys(f.sync.bindings).length,0);assert.match(f.el('status').textContent,/现有标记保留/);
 assert.equal(f.el('stop').disabled,true);assert.equal(f.el('now').disabled,true);
 assert.equal(f.el('pdf').value,'1:PDF00001');assert.equal(f.el('enable').disabled,false);
 await f.el('enable').listeners.click();assert.ok(f.sync.bindings['1:PDF00001']);
});
test('changing MD requires saving the association and immediate sync cannot target the old MD by accident',async()=>{
 const f=fixture({bound:true});f.el('md').value='MD000002';f.el('md').listeners.change();assert.equal(f.el('now').disabled,true);
 await f.el('enable').listeners.click();assert.equal(f.calls[0][3].key,'MD000002');assert.equal(f.el('md').value,'MD000002');assert.equal(f.el('now').disabled,false);
});
test('no selection or unavailable module disables write actions; refresh reads newly selected PDF',()=>{
 const f=fixture({selected:false});assert.equal(f.el('enable').disabled,true);assert.match(f.el('status').textContent,/选中 PDF/);
 f.setSelected([f.pdf]);f.el('refresh').listeners.click();assert.equal(f.el('enable').disabled,false);
 const g=fixture({ready:false});assert.equal(g.el('enable').disabled,true);assert.equal(g.el('refresh').disabled,true);assert.match(g.el('status').textContent,/暂未载入/);
});
test('active reader is selectable without changing the library selection',()=>{
 const f=fixture({selected:false,activeReader:true});assert.equal(f.el('pdf').value,'1:PDF00001');assert.equal(f.el('enable').disabled,false);
});
test('standalone PDF without a parent disables pairing and explains the missing MD',()=>{
 const f=fixture({standalone:true});assert.equal(f.el('enable').disabled,true);assert.match(f.el('status').textContent,/同条目下没有可选的 MD/);
});
test('failures and cancellation retain controls and show a useful status',async()=>{
 const f=fixture();f.sync.enable=async()=>{throw Error('文件尚未下载');};
 await f.el('enable').listeners.click();assert.equal(f.el('enable').disabled,false);assert.equal(f.el('status').textContent,'文件尚未下载');
 f.sync.enable=async()=>false;await f.el('enable').listeners.click();assert.match(f.el('status').textContent,/已取消/);
});
test('Markdown controls are inside highlights/copy settings and absent from item context menu',()=>{
 const xhtml=fs.readFileSync(path.join(root,'plugin/content/preferences.xhtml'),'utf8');
 assert.ok(xhtml.indexOf('id="markdown-sync-settings"')>xhtml.indexOf('id="pocr-page-text"'));
 assert.ok(xhtml.indexOf('id="markdown-sync-settings"')<xhtml.indexOf('id="pocr-page-preview"'));
 const repair=fs.readFileSync(path.join(root,'plugin/repair.js'),'utf8');
 assert.doesNotMatch(repair,/menu\('将 PDF 高亮同步|menu\('停止此 PDF 的 Markdown/);
 assert.match(repair,/content\/markdownPreferences.js/);
});
