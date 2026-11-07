'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function fixture({enabled=false,ready=true}={}){
 const toggle={checked:false,disabled:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}},status={textContent:''},panel={dataset:{}};
 const calls=[],listeners=new Set();let unload;
 const sync={ready,enabled,status:{running:false,synced:0,failed:0},subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},
  async setEnabled(value){calls.push(value);this.enabled=value;for(const listener of listeners)listener();}};
 const document={getElementById:id=>({'markdown-sync-settings':panel,'markdown-sync-enabled':toggle,'markdown-sync-status':status})[id]};
 vm.runInNewContext(fs.readFileSync(path.join(root,'plugin/content/markdownPreferences.js'),'utf8'),{
  Zotero:{PaddleOCRRepair:{markdownSync:sync}},document,window:{addEventListener:(event,fn)=>{assert.equal(event,'unload');unload=fn;}},setTimeout});
 return {toggle,status,sync,calls,listeners,unload};
}
test('one checkbox immediately controls all documents without a PDF/MD selector or a separate save button',async()=>{
 const f=fixture();assert.equal(f.toggle.checked,false);f.toggle.checked=true;await f.toggle.listeners.change();
 assert.deepEqual(f.calls,[true]);assert.equal(f.toggle.disabled,false);assert.match(f.status.textContent,/所有文献条目/);
 f.toggle.checked=false;await f.toggle.listeners.change();assert.deepEqual(f.calls,[true,false]);assert.match(f.status.textContent,/现有高亮标记保留/);
});
test('saved global state and background progress are shown while the switch remains available',()=>{
 const f=fixture({enabled:true});assert.equal(f.toggle.checked,true);f.sync.status={running:true,synced:12,failed:0};
 for(const listener of f.listeners)listener();assert.match(f.status.textContent,/12 个 PDF/);assert.equal(f.toggle.disabled,false);
 f.unload();assert.equal(f.listeners.size,0);
});
test('save failure restores the previous switch state and unavailable module is disabled',async()=>{
 const f=fixture();f.sync.setEnabled=async()=>{throw Error('设置保存失败');};f.toggle.checked=true;await f.toggle.listeners.change();
 assert.equal(f.toggle.checked,false);assert.equal(f.toggle.disabled,false);assert.equal(f.status.textContent,'设置保存失败');
 const g=fixture({ready:false});assert.equal(g.toggle.disabled,true);assert.match(g.status.textContent,/暂未载入/);
});
test('settings markup contains exactly one global toggle and distinguishes MD attachments from Zotero notes',()=>{
 const html=fs.readFileSync(path.join(root,'plugin/content/preferences.xhtml'),'utf8');
 const section=html.slice(html.indexOf('id="markdown-sync-settings"'),html.indexOf('<html:h3>整理方式'));
 assert.equal((section.match(/<html:input/g)||[]).length,1);assert.doesNotMatch(section,/<html:(?:select|button)/);
 assert.match(section,/不将 Zotero 笔记或注释当作同步文件/);
});
