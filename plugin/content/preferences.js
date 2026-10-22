'use strict';
var pocrPrefAttempts=0;
function pocrBindPrefs(){
  const root=document.getElementById('pocr-preferences');
  if(!root){if(++pocrPrefAttempts<100)setTimeout(pocrBindPrefs,50);return;}
  if(root.dataset.bound)return;root.dataset.bound='1';
  const app=Zotero.PaddleOCRRepair,el=id=>document.getElementById(id);
  const links=[...root.querySelectorAll('[data-page-target]')],pages=[...root.querySelectorAll('[data-settings-page]')];
  function showPage(name){
    const link=links.find(node=>node.dataset.pageTarget===name);if(!link)return;
    for(const page of pages)page.hidden=page.dataset.settingsPage!==name;
    for(const group of root.querySelectorAll('[data-settings-group]'))group.hidden=group.dataset.settingsGroup!==link.dataset.pageGroup;
    for(const other of links){if(other===link)other.setAttribute('aria-current','page');else other.removeAttribute('aria-current');}
    link.closest('details').open=true;el('pocr-settings-location').textContent=link.dataset.pageLabel;
  }
  root.pocrShowPage=showPage;
  for(const link of links)link.addEventListener('click',()=>showPage(link.dataset.pageTarget));
  showPage('text');
  const fields=['baseURL','model','dailyThreshold','concurrency','partConcurrency','autoReplace','backupDir','sidecars','pythonPath','legacyPDFScale'];
  for(const key of fields){const field=el('pocr-'+key),value=app.pref(key);if(key==='autoReplace')field.checked=!!value;else field.value=value??'';}
  const storage={archive:'资料放入“PDF Repair 识别存档”集合，并关联原文献；原文献下不再堆放 MD/JSON，可按 Zotero 附件规则同步。',
    hidden:'资料只保存在当前电脑的插件目录，不新增 Zotero 附件，也不会通过文献库同步。',
    import:'MD/JSON 作为普通附件，直接显示在原文献下，可按 Zotero 附件规则同步。',
    link:'原文献下只保留指向文件的链接；Zotero 不会同步这些文件，跨设备时需自己管理路径。'};
  const storageHelp=()=>el('pocr-sidecars-help').textContent=storage[el('pocr-sidecars').value]||'';
  el('pocr-sidecars').addEventListener('change',storageHelp);storageHelp();
  const tokenState=async()=>{
    try{el('pocr-token-state').textContent=await app.token() ? '已保存访问令牌；留空不会删除，也不会回显。' : '尚未保存访问令牌；仍可合并已有 MD/JSON。';}
    catch(_){el('pocr-token-state').textContent='暂时无法读取令牌状态，请重试；不会显示令牌内容。';}
  };
  const action=fn=>async()=>{
    try{await fn();}
    catch(e){
      if(e.field){const field=el(e.field);showPage(field.closest('[data-settings-page]').dataset.settingsPage);field.focus();}
      el('pocr-message').textContent=e.message;
    }
  };
  const invalid=(message,key)=>{const error=new Error(message);error.field='pocr-'+key;throw error;};
  el('pocr-save').addEventListener('click',action(async()=>{
    const values={};
    for(const key of fields){const field=el('pocr-'+key);values[key]=key==='autoReplace' ? field.checked : field.value.trim();}
    let url;try{url=new URL(values.baseURL);}catch(_){invalid('请填写完整的识别服务地址，例如默认的 https:// 地址。','baseURL');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)invalid('服务地址须以 https:// 开头，不能在地址中附带账号、密码或查询参数。','baseURL');
    for(const key of ['dailyThreshold','concurrency','partConcurrency']){
      values[key]=Number(values[key]);
      if(!Number.isInteger(values[key])||values[key]<1||(key!=='dailyThreshold'&&values[key]>2))
        invalid(key==='dailyThreshold' ? '页数提醒请填大于 0 的整数。' : '同时处理的数量只能选择 1 或 2。',key);
    }
    if(!Number.isFinite(Number(values.legacyPDFScale))||Number(values.legacyPDFScale)<0||Number(values.legacyPDFScale)>8)
      invalid('坐标倍率请填 0–8 之间的数字；不确定时保持 0。','legacyPDFScale');
    // Validate the whole group before saving any field, including fields on hidden subpages.
    const token=el('pocr-token');if(token.value.trim())await app.saveToken(token.value.trim());
    token.value='';for(const key of fields)app.setPref(key,values[key]);await tokenState();
    if(app.connection){try{await app.configure();}catch(_){el('pocr-message').textContent='设置已保存，但后台暂未同步。下次操作前请重试保存；未提交新识别任务。';return;}}
    el('pocr-message').textContent='OCR / PDF 设置已保存，对之后的任务生效。';
  }));
  el('pocr-delete-token').addEventListener('click',action(async()=>{
    if(!window.confirm('删除已保存的访问令牌？下次云端识别需重新填写；本地合并不受影响。'))return;
    await app.saveToken('');el('pocr-token').value='';await tokenState();
    if(app.connection)await app.configure();el('pocr-message').textContent='已删除访问令牌。已有文件、任务记录和备份未删除。';
  }));
  el('pocr-status').addEventListener('click',()=>app.openStatus());
  el('pocr-clear-cache').addEventListener('click',action(async()=>{
    if(!window.confirm('清理可重新生成的派生缓存？任务记录、原始响应、MD/JSON、PDF 和恢复备份都会保留。'))return;
    await app.ensure();await app.request('POST','/cache/clear',{});
    el('pocr-message').textContent='派生缓存已清理。任务记录、识别资料和恢复备份保留。';
  }));
  root.addEventListener('input',event=>{
    if(event.target.id.startsWith('text-preview-'))return;
    const group=event.target.closest('[data-settings-group]');if(!group)return;
    el(group.dataset.settingsGroup==='text'?'text-settings-message':'pocr-message').textContent='有尚未保存的修改；切换页面不会丢失，请在下方保存。';
  });
  tokenState();
}
pocrBindPrefs();
