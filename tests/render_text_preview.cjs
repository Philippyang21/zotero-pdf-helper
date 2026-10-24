'use strict';
// Full settings UI with actual shipped CSS/scripts, fake local preferences and item API.
// Generated pages use no Zotero session, user PDF, real token, network or OCR helper.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.argv[2]||path.join(root,'work','text-preview.html'));
const source=name=>fs.readFileSync(path.join(root,'plugin/content',name),'utf8');
const markup=source('preferences.xhtml').replace(/^<vbox[^>]*>/,'').replace(/<\/vbox>\s*$/,'')
 .replace(/(<\/?)(?:html:)/g,'$1').replace(/<link[^>]*\/>/,'<style>'+source('preferences.css')+'</style>');
const modules=['options','protected','lineBreaks','whitespace','punctuation','index','annotations'].map(name=>source('text/'+name+'.js')).join('\n');
const setup=`
const prefs=new Map(),writes=[],copied=[],errors=[],events=new Map(),observers=new Map(),items=new Map(),persisted=new Map();
let observerSerial=0,saveCount=0,configured=0,ensured=0,requests=0,statusOpened=0,tokenSaves=0,confirmAnswer=false;
const notices=[],prompts=[];
let storedToken='fixture-only-token',tokenReadFailure=false;
window.pref=(name,value)=>prefs.set(name.replace('extensions.paddleocrrepair.',''),value);
window.confirm=()=>confirmAnswer;
const reader={itemID:10,_instanceID:'example-native-reader'};
window.Zotero={Items:{get:id=>items.get(id),getByLibraryAndKey:(lib,key)=>[...items.values()].find(x=>x.libraryID===lib&&x.key===key)},
 Reader:{_readers:[reader],registerEventListener:(type,fn)=>events.set(type,fn),unregisterEventListener:type=>events.delete(type)},
 Notifier:{registerObserver:observer=>{const id=++observerSerial;observers.set(id,observer);return id;},unregisterObserver:id=>observers.delete(id)},
 logError:e=>errors.push(String(e)),PaddleOCRRepair:null};
window.Cc={'@mozilla.org/widget/clipboardhelper;1':{getService:()=>({copyString:value=>copied.push(value)})}};
window.Ci={nsIClipboardHelper:{}};
const app={id:'fixture-only',connection:null,pref:key=>prefs.get(key),setPref:(key,value)=>{writes.push(key);prefs.set(key,value);},
 token:async()=>{if(tokenReadFailure)throw new Error('fixture');return storedToken;},saveToken:async value=>{storedToken=value;tokenSaves++;},
 configure:async()=>configured++,ensure:async()=>ensured++,request:async()=>requests++,openStatus:()=>statusOpened++,alert:message=>errors.push(message),
 confirm:message=>{prompts.push(message);return confirmAnswer;},notify:message=>notices.push(message)};
const el=id=>document.getElementById(id),event=(node,type)=>node.dispatchEvent(new Event(type,{bubbles:true}));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const emit=async(type,ids,extra)=>{for(const observer of observers.values())await observer.notify(type,'item',ids,extra);};
items.set(10,{id:10,libraryID:1,isAttachment:()=>true,attachmentReaderType:'pdf'});
function renderNative(item){
 let row=el('annotation-'+item.id);if(!row){row=document.createElement('div');row.id='annotation-'+item.id;row.className='content';el('native-example').append(row);}
 row.textContent=item.annotationText;
}
async function newHighlight(id,text='中国 文学, "史料"如此.'){
 const item={id,key:'EXAMPLE'+id,libraryID:1,parentID:10,annotationType:'highlight',annotationIsExternal:false,
  annotationText:text,isAnnotation:()=>true,isEditable:()=>true,
  async saveTx(options){saveCount++;persisted.set(id,this.annotationText);renderNative(this);await emit('modify',[id],{[id]:options.notifierData});}};
 items.set(id,item);persisted.set(id,text);renderNative(item);await emit('add',[id],{[id]:{instanceID:reader._instanceID}});return item;
}
`;
const checks=`
const updateConfig={schemaVersion:4,repositoryUrl:'https://github.com/test-owner/test-plugin',latestReleaseUrl:'https://github.com/test-owner/test-plugin/releases/latest',assetNamePrefix:'pdf-helper',timeoutMs:10000,maxResponseBytes:65536};
let updateConfigValue=updateConfig,updateRequests=0,updateFailure=false,updateAnswer=false;
const updateOpened=[],updatePrompts=[];
const updateFeed={schemaVersion:2,published:true,addonId:'fixture-only',latestVersion:'0.1.11',minZoteroVersion:'10.0',maxZoteroVersion:'10.0.*',releaseNotes:'离线示例：手动检查更新。',releaseUrl:updateConfig.repositoryUrl+'/releases/tag/v0.1.11'};
const updateCompare=(a,b)=>{a=a.split('.');b=b.split('.');for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]==='*'?Infinity:Number(a[i]||0),y=b[i]==='*'?Infinity:Number(b[i]||0);if(x!==y)return x<y?-1:1;}return 0;};
app.version='0.1.11';
const updateClient=POCRUpdates.createClient({addonId:app.id,currentVersion:()=>app.version,zoteroVersion:()=> '10.0.6',compareZotero:updateCompare,loadConfig:async()=>updateConfigValue,request:async()=>{updateRequests++;if(updateFailure){const error=new Error('offline fixture');if(typeof updateFailure==='string')error.code=updateFailure;throw error;}return {...updateFeed};},confirm:result=>{updatePrompts.push(result);return updateAnswer;},openURL:url=>updateOpened.push(url)});
app.updates=updateClient;
const tools=new AcademicTextUI(app);app.textTools=tools;Zotero.PaddleOCRRepair=app;tools.init();
const results=[],assert=(ok,message)=>{if(!ok)throw new Error(message);};
const run=async(name,fn)=>{try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e)});}};
const nav=name=>document.querySelector('[data-page-target="'+name+'"]');let first;
window.addEventListener('load',async()=>{
 await tick();
 await run('all nine pages use two-level native-button navigation with one visible panel',()=>{
  assert(document.querySelectorAll('.pocr-nav details').length===3,'three top groups');
  for(const name of ['text','preview','account','speed','files','python','legacy','maintenance','updates']){
   nav(name).click();assert(document.querySelectorAll('[data-settings-page]:not([hidden])').length===1,'one visible page');
   assert(!el('pocr-page-'+name).hidden&&nav(name).getAttribute('aria-current')==='page','active link');
   assert(el('pocr-settings-location').textContent===nav(name).dataset.pageLabel,'breadcrumb');
  }nav('text').click();
 });
 await run('every settings page fits the current viewport without horizontal overflow',()=>{
  for(const name of ['text','preview','account','speed','files','python','legacy','maintenance','updates']){
   nav(name).click();assert(document.documentElement.scrollWidth<=window.innerWidth+1,'page overflow: '+name);
  }nav('text').click();
 });
 await run('settings keep all original OCR controls and describe persistent cleanup clearly',()=>{
  for(const name of ['baseURL','model','dailyThreshold','concurrency','partConcurrency','autoReplace','backupDir','sidecars','pythonPath','legacyPDFScale'])assert(!!el('pocr-'+name),name);
  assert(el('text-clean-new').checked&&!el('text-sidebar'),'new switch');
  assert(el('pocr-page-text').textContent.includes('不保留修改前的副本'),'warning');assert(!el('pocr-page-text').textContent.includes('CJK'),'plain-language text');
 });
 await run('defaults and live preview protect DOI without invoking OCR or annotation saving',()=>{
  assert(el('text-preset').value==='paper'&&el('text-punctuation').value==='smart','default preset');
  assert(el('text-preview-output').value.includes('朱自清认为，“诗教”'),'Chinese preview');
  assert(el('text-preview-output').value.includes('DOI: 10.1234/abc.2026.01'),'DOI');assert(saveCount===0&&ensured===0&&requests===0,'no backend');
 });
 await run('navigation preserves unsaved fields and preset/custom changes do not save',()=>{
  const before=writes.length;el('pocr-backupDir').value='example-only-backup';nav('files').click();nav('text').click();nav('files').click();
  assert(el('pocr-backupDir').value==='example-only-backup','unsaved retained');el('pocr-backupDir').value='';
  nav('text').click();el('text-preset').value='light';event(el('text-preset'),'change');assert(el('text-punctuation').value==='preserve','light');
  for(const mode of ['chinese','english','smart','preserve']){el('text-punctuation').value=mode;event(el('text-punctuation'),'change');assert(el('text-preset').value==='custom','custom');}
  el('text-preset').value='paper';event(el('text-preset'),'change');assert(writes.length===before,'not saved');
 });
 await run('text save is separate from OCR configuration and applies to ordinary PDF highlights',async()=>{
  const before=ensured;el('text-save').click();first=await newHighlight(20);
  assert(persisted.get(20)==='中国文学，“史料”如此。'&&el('annotation-20').textContent===persisted.get(20),'actual saved simulated value');
  assert(writes.every(key=>key.startsWith('text.'))&&ensured===before&&configured===0,'no OCR configure');
  assert(!document.querySelector('.pocr-cleaned-quote,[data-pocr-display]'),'no overlay');
 });
 await run('auto switch off skips future highlights but never restores saved values',async()=>{
  el('text-clean-new').checked=false;el('text-save').click();await newHighlight(21);
  assert(persisted.get(21)==='中国 文学, "史料"如此.'&&persisted.get(20)==='中国文学，“史料”如此。','future only');
 });
 await run('master off disables controls and preserves new annotation text',async()=>{
  el('text-enabled').checked=false;event(el('text-enabled'),'change');el('text-save').click();await newHighlight(22);
  assert(el('text-clean-new').disabled&&el('text-preview-input').value===el('text-preview-output').value,'disabled preview');
  assert(persisted.get(22)==='中国 文学, "史料"如此.','unchanged');
  el('text-enabled').checked=true;event(el('text-enabled'),'change');el('text-clean-new').checked=true;el('text-save').click();
 });
 await run('later mode changes and manual annotation edits do not rewrite saved history',async()=>{
  el('text-punctuation').value='english';event(el('text-punctuation'),'change');el('text-save').click();await newHighlight(23,'中文，研究。');
  assert(persisted.get(23)==='中文, 研究.'&&persisted.get(20)==='中国文学，“史料”如此。','new mode only');
  first.annotationText='手工 编辑, 保留.';await first.saveTx({notifierData:{instanceID:reader._instanceID}});assert(persisted.get(20)==='手工 编辑, 保留.','manual edit');
 });
 await run('annotation menu offers selected-only save without writing on menu open',()=>{
  const before=saveCount;
  const menu=[];events.get('createAnnotationContextMenu')({reader,params:{ids:[first.key]},append:item=>menu.push(item)});
  assert(menu.length===3&&menu[2].label==='整理并保存选中高亮文字…','save entry');menu[1].onCommand();assert(copied.at(-1)===first.annotationText,'saved copy');
  assert(saveCount===before,'menu alone is read-only');
 });
 await run('selected old highlight save requires confirmation and preserves unselected history',async()=>{
  const menu=[];events.get('createAnnotationContextMenu')({reader,params:{ids:[first.key]},append:item=>menu.push(item)});
  const before=saveCount,untouched=persisted.get(21);confirmAnswer=false;await menu[2].onCommand();assert(saveCount===before,'cancelled');
  confirmAnswer=true;await menu[2].onCommand();confirmAnswer=false;
  assert(persisted.get(20)==='手工编辑, 保留.'&&el('annotation-20').textContent===persisted.get(20),'saved selected only');
  assert(persisted.get(21)===untouched&&saveCount===before+1,'other history untouched');assert(notices.at(-1).includes('已保存 1 条'),'result feedback');
 });
 await run('current rules clean Chinese quote and PDF thin spaces in preview and old highlights',async()=>{
  nav('text').click();el('text-preset').value='paper';event(el('text-preset'),'change');el('text-clean-new').checked=false;el('text-save').click();
  const old=await newHighlight(24,'制造 “碎片化” 与 “整体化” 的对立,洪\\u2009子诚。');
  const menu=[];events.get('createAnnotationContextMenu')({reader,params:{ids:[old.key]},append:item=>menu.push(item)});
  assert(persisted.get(24).includes(' “'),'auto off');confirmAnswer=true;await menu[2].onCommand();confirmAnswer=false;
  assert(persisted.get(24)==='制造“碎片化”与“整体化”的对立，洪子诚。','old highlight rules');
  nav('preview').click();el('text-preview-input').value='制造 “碎片化” 与 “整体化” 的对立。';event(el('text-preview-input'),'input');
  assert(el('text-preview-output').value==='制造“碎片化”与“整体化”的对立。','live preview same rules');
  nav('text').click();el('text-clean-new').checked=true;el('text-save').click();
 });
 await run('all four storage choices explain where files go without moving files',()=>{
  nav('files').click();const before=requests;
  for(const value of ['archive','hidden','import','link']){el('pocr-sidecars').value=value;event(el('pocr-sidecars'),'change');assert(el('pocr-sidecars-help').textContent.length>10,'storage explanation');}
  assert(requests===before,'no movement');el('pocr-sidecars').value='archive';event(el('pocr-sidecars'),'change');
 });
 await run('invalid hidden-page values reveal the right page before any preferences or token writes',async()=>{
  const before=writes.length,tokens=tokenSaves;el('pocr-legacyPDFScale').value='9';nav('account').click();el('pocr-save').click();await tick();
  assert(!el('pocr-page-legacy').hidden&&document.activeElement===el('pocr-legacyPDFScale'),'jump to error');
  assert(writes.length===before&&tokenSaves===tokens,'no partial writes');el('pocr-legacyPDFScale').value='0';
  el('pocr-baseURL').value='http://invalid.example';el('pocr-save').click();await tick();assert(!el('pocr-page-account').hidden,'service page');el('pocr-baseURL').value='https://paddleocr.aistudio-app.com';
 });
 await run('valid OCR save preserves blank token, all fields and does not launch new OCR',async()=>{
  const before=tokenSaves;el('pocr-token').value='';el('pocr-save').click();await tick();
  assert(tokenSaves===before&&storedToken==='fixture-only-token','blank retains secret');assert(prefs.get('concurrency')===1&&prefs.get('partConcurrency')===2,'numeric saved');
  assert(ensured===0&&requests===0,'not launched');assert(el('pocr-message').textContent.includes('已保存'),'saved message');
 });
 await run('token replacement clears password field and active helper is configured only after saving',async()=>{
  app.connection={};el('pocr-token').value='fixture-replacement';el('pocr-save').click();await tick();
  assert(storedToken==='fixture-replacement'&&el('pocr-token').value==='','secret not echoed');assert(configured===1&&ensured===0,'configure only');app.connection=null;
 });
 await run('token deletion requires confirmation and does not remove files or tasks',async()=>{
  const before=tokenSaves;confirmAnswer=false;el('pocr-delete-token').click();await tick();assert(tokenSaves===before,'cancelled');
  confirmAnswer=true;el('pocr-delete-token').click();await tick();assert(storedToken===''&&el('pocr-token').value==='','deleted');assert(requests===0,'no task deletion');confirmAnswer=false;
 });
 await run('cache cleanup requires confirmation and runs only from explicit maintenance action',async()=>{
  nav('maintenance').click();el('pocr-clear-cache').click();await tick();assert(ensured===0&&requests===0,'cancel');
  confirmAnswer=true;el('pocr-clear-cache').click();await tick();assert(ensured===1&&requests===1,'one explicit request');confirmAnswer=false;
  el('pocr-status').click();assert(statusOpened===1,'existing task window');
 });
 await run('preview copy remains independent of saving settings or annotation writes',()=>{
  nav('text').click();el('text-preset').value='paper';event(el('text-preset'),'change');nav('preview').click();
  el('text-preview-input').value='中国 文学。';event(el('text-preview-input'),'input');const before=saveCount;
  el('text-preview-copy').click();el('text-preview-original').click();assert(copied.at(-2)==='中国文学。'&&copied.at(-1)==='中国 文学。','copy choices');assert(saveCount===before,'no saved quote');
 });
 await run('token read failure does not disable navigation or text settings',async()=>{
  tokenReadFailure=true;nav('python').click();el('pocr-save').click();await tick();assert(el('pocr-token-state').textContent.includes('无法读取'),'read failure fallback');
  nav('text').click();el('text-save').click();assert(el('text-settings-message').textContent.includes('已保存'),'text still works');tokenReadFailure=false;
 });
 await run('shutdown unregisters new-item observer and retains saved annotation values',async()=>{
  await tools.shutdown();assert(events.size===0&&observers.size===0,'released');assert(persisted.get(23)==='中文, 研究.','no restore');
 });
 await run('opening settings and the update page sends zero update requests',()=>{
  nav('updates').click();assert(updateRequests===0,'no automatic request');assert(el('pocr-update-version').textContent.includes('0.1.11'),'installed version');
  assert(el('pocr-ocr-settings').hidden&&el('pocr-text-settings').hidden,'separate update page');
 });
 await run('explicit check shows checking then current with no browser launch',async()=>{
  el('pocr-update-check').click();assert(el('pocr-update-check').disabled&&el('pocr-update-status').textContent.includes('正在检查'),'busy state');await tick();
  assert(updateRequests===1&&el('pocr-update-status').textContent==='当前已是最新版本。','current');assert(el('pocr-update-download').hidden&&updateOpened.length===0,'no navigation');
   app.version='0.1.13';el('pocr-update-check').click();await tick();
   assert(el('pocr-update-status').textContent.includes('高于 GitHub 最新正式版 v0.1.11'),'candidate ahead of published release');
   assert(el('pocr-update-download').hidden,'no downgrade');app.version='0.1.11';
 });
 await run('new version displays notes as plain text and compatible requirements',async()=>{
  updateFeed.latestVersion='0.1.12';updateFeed.releaseUrl=updateConfig.repositoryUrl+'/releases/tag/v0.1.12';updateFeed.releaseNotes='<img src=x onerror=alert(1)> 更新说明';el('pocr-update-check').click();await tick();
  assert(el('pocr-update-status').textContent==='发现新版本 v0.1.12。','available');assert(!el('pocr-update-download').hidden,'download action');
  assert(el('pocr-update-notes').textContent===updateFeed.releaseNotes&&!el('pocr-update-notes').querySelector('img'),'no remote markup');
  assert(el('pocr-update-requirements').textContent.includes('10.0.*'),'range');
 });
 await run('cancel stays in settings; acceptance opens only the matching GitHub release',async()=>{
  const originalEnsured=ensured,originalRequests=requests,originalSaves=saveCount;
  el('pocr-update-download').click();await tick();assert(updateOpened.length===0&&el('pocr-update-status').textContent.includes('已取消'),'cancel');
  assert(!el('pocr-page-updates').hidden,'stays here');updateAnswer=true;el('pocr-update-download').click();await tick();
  assert(updateOpened.length===1&&updateOpened[0]===updateFeed.releaseUrl,'matching release only');
  assert(el('pocr-update-download').textContent==='前往 GitHub 下载'&&el('pocr-update-status').textContent.includes('GitHub 版本发布页'),'GitHub wording');
  assert(ensured===originalEnsured&&requests===originalRequests&&saveCount===originalSaves,'no OCR or annotation operation');
 });
 await run('failed recheck hides stale download and offers user retry',async()=>{
  updateFailure=true;el('pocr-update-check').click();await tick();assert(el('pocr-update-status').textContent.includes('暂时无法'),'failure');
  assert(el('pocr-update-download').hidden&&!el('pocr-update-check').disabled&&el('pocr-update-check').textContent==='重试','retry');updateFailure='rate-limit';el('pocr-update-check').click();await tick();assert(el('pocr-update-status').textContent.includes('限制'),'explicit access restriction');updateFailure=false;
 });
 await run('incompatible release shows warning and no recommended download',async()=>{
  updateFeed.minZoteroVersion='11.0';updateFeed.maxZoteroVersion='11.*';el('pocr-update-check').click();await tick();
  assert(el('pocr-update-status').textContent.includes('不支持'),'warning');assert(el('pocr-update-download').hidden&&!el('pocr-update-details').hidden,'not recommended');
  updateFeed.minZoteroVersion='10.0';updateFeed.maxZoteroVersion='10.0.*';
 });
 await run('missing deployment configuration is explicit and makes no request',async()=>{
  const count=updateRequests;updateConfigValue={...updateConfig,latestReleaseUrl:null};el('pocr-update-check').click();await tick();
  assert(updateRequests===count&&el('pocr-update-status').textContent.includes('尚未配置'),'not configured');assert(el('pocr-update-download').hidden,'no link');updateConfigValue=updateConfig;
 });
 await run('unavailable update module does not break other settings',async()=>{
  app.updates=null;el('pocr-update-check').click();await tick();assert(el('pocr-update-status').textContent.includes('暂时无法'),'failure isolated');
  nav('preview').click();assert(!el('pocr-page-preview').hidden,'original navigation works');app.updates=updateClient;
 });
 const selected=new URL(location.href).searchParams.get('page')||'text';
 if(selected==='updates'){updateFeed.releaseNotes='离线示例：新增手动检查更新。下载 .xpi 后由用户完成安装。';el('pocr-update-check').click();await tick();}
 el('pocr-preferences').pocrShowPage(selected);
 el('pocr-message').textContent='';el('text-settings-message').textContent='';
 el('pocr-token-state').textContent='尚未保存访问令牌；仍可合并已有 MD/JSON。';document.activeElement?.blur();
 el('qa-result').textContent=JSON.stringify({passed:results.every(r=>r.passed),count:results.length,results});
 el('qa-status').textContent=results.filter(r=>r.passed).length+'/'+results.length+' 项离线界面/模拟保存检查通过（非原生 Zotero 实测）';document.documentElement.dataset.qaComplete='true';
});
`;
const scripts=modules+'\n'+source('updates.js')+'\n'+setup+'\n'+fs.readFileSync(path.join(root,'plugin/prefs.js'),'utf8')+'\n'+source('textUI.js')+'\n'+checks+'\n'+source('preferences.js')+'\n'+source('textPreferences.js')+'\n'+source('updatePreferences.js');
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>0.1.10 设置·离线验证</title><style>html{color-scheme:light dark}body{font:14px/1.6 system-ui;margin:24px;background:Canvas;color:CanvasText}#qa-status{font-size:12px;color:GrayText}#qa-result{white-space:pre-wrap;font-size:11px}</style><script>if(new URL(location.href).searchParams.has("light"))document.documentElement.style.colorScheme="light";</script></head><body><p id="qa-status">正在验证示例界面…</p>'+markup+'<div id="native-example" hidden></div><pre id="qa-result" hidden></pre><script>'+scripts.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);console.log(output);
