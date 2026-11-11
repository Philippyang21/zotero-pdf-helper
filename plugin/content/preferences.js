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
  const localKeys=['localPython','localDevice','localCache','localConfig','localFormula'];
  const checkboxes=new Set(['autoReplace','localEnabled','localFormula','localKeepModel']);
  const fields=['localEnabled','localKeepModel',...localKeys,'baseURL','model','dailyThreshold','concurrency','partConcurrency','autoReplace','backupDir','sidecars','pythonPath','legacyPDFScale'];
  for(const key of fields){const field=el('pocr-'+key),value=app.pref(key);if(checkboxes.has(key))field.checked=!!value;else field.value=value??'';}
  const updateBackend=()=>{
    el('pocr-local-fields').hidden=!el('pocr-localEnabled').checked;
  };
  el('pocr-localEnabled').addEventListener('change',updateBackend);updateBackend();
  el('pocr-local-browse').addEventListener('click',()=>action(async()=>{
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker=new FilePicker();picker.init(window,'选择 PaddleOCR 部署目录或 Python 环境目录',picker.modeGetFolder);
    if(await picker.show()===picker.returnOK){
      el('pocr-localPython').value=picker.file;
      el('pocr-localPython').dispatchEvent(new Event('input',{bubbles:true}));
    }
  })());
  el('pocr-local-check').addEventListener('click',async()=>{
    const button=el('pocr-local-check'),state=el('pocr-local-state');
    button.disabled=true;state.textContent='正在加载本地环境…';
    try {
      const values=Object.fromEntries(localKeys.map(k=>[k,checkboxes.has(k) ? el('pocr-'+k).checked : el('pocr-'+k).value.trim()]));
      if(!values.localPython)throw new Error('请先选择部署目录或输入模型环境的 Python 路径。');
      await app.ensure();
      const info=await app.request('POST','/local/check',values,100000);
      state.textContent='已载入 PaddleOCR '+info.version+'，设备 '+info.device+'。可直接识别 PDF；首次识别时加载模型权重。';
    } catch(e){state.textContent=e.message;}
    finally {button.disabled=false;}
  });
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

  // Persist each edited field independently. Unfinished input on another page must
  // not block a valid change. Serialize backend configuration and token writes.
  const pending=new Map();let syncQueue=Promise.resolve();
  const synchronize=()=>{
    if(!app.connection)return;
    syncQueue=syncQueue.then(()=>app.configure()).catch(()=>{
      el('pocr-message').textContent='设置已保存，后台暂未同步；下次识别前会重新读取设置。';
    });
  };
  function saveField(key){
    clearTimeout(pending.get(key));pending.delete(key);
    const field=el('pocr-'+key);let value=checkboxes.has(key)?field.checked:field.value.trim();
    try{
      if(key==='baseURL'){
        let url;try{url=new URL(value);}catch(_){invalid('请填写完整的识别服务地址，例如默认的 https:// 地址。','baseURL');}
        if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)invalid('服务地址须以 https:// 开头，不能在地址中附带账号、密码或查询参数。','baseURL');
      }
      if(['dailyThreshold','concurrency','partConcurrency'].includes(key)){
        value=Number(value);
        if(!Number.isInteger(value)||value<1||(key!=='dailyThreshold'&&value>2))
          invalid(key==='dailyThreshold' ? '页数提醒请填大于 0 的整数。' : '同时处理的数量只能选择 1 或 2。',key);
      }
      if(key==='legacyPDFScale'&&(!value||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>8))
        invalid('坐标倍率请填 0–8 之间的数字；不确定时保持 0。','legacyPDFScale');
      app.setPref(key,value);field.removeAttribute('aria-invalid');synchronize();
      el('pocr-message').textContent='设置已自动保存。';
    }catch(e){field.setAttribute('aria-invalid','true');el('pocr-message').textContent='此项未保存：'+e.message;}
  }
  for(const key of fields){
    const field=el('pocr-'+key);
    field.addEventListener('change',()=>saveField(key));
    if(!checkboxes.has(key)&&field.tagName.toLowerCase()!=='select')field.addEventListener('input',()=>{
      clearTimeout(pending.get(key));pending.set(key,setTimeout(()=>saveField(key),500));
    });
  }
  let tokenQueue=Promise.resolve();
  const saveToken=()=>{
    const token=el('pocr-token'),value=token.value.trim();if(!value)return;
    tokenQueue=tokenQueue.then(async()=>{
      await app.saveToken(value);if(token.value.trim()===value)token.value='';
      await tokenState();synchronize();el('pocr-message').textContent='访问令牌已自动保存。';
    }).catch(()=>{el('pocr-message').textContent='访问令牌未能保存，请重新填写并重试。';});
  };
  el('pocr-token').addEventListener('change',saveToken);
  // Write pending ordinary preferences synchronously before the pane is removed.
  const flush=()=>{for(const key of [...pending.keys()])saveField(key);};
  window.addEventListener('pagehide',flush);window.addEventListener('unload',flush);

  el('pocr-delete-token').addEventListener('click',action(async()=>{
    if(!window.confirm('删除已保存的访问令牌？下次云端识别需重新填写；本地合并不受影响。'))return;
    el('pocr-token').value='';await tokenQueue;await app.saveToken('');await tokenState();
    if(app.connection)await app.configure();el('pocr-message').textContent='已删除访问令牌。已有文件、任务记录和备份未删除。';
  }));
  el('pocr-status').addEventListener('click',()=>app.openStatus());
  el('pocr-clear-cache').addEventListener('click',action(async()=>{
    if(!window.confirm('清理可重新生成的派生缓存？任务记录、原始响应、MD/JSON、PDF 和恢复备份都会保留。'))return;
    await app.ensure();await app.request('POST','/cache/clear',{});
    el('pocr-message').textContent='派生缓存已清理。任务记录、识别资料和恢复备份保留。';
  }));
  root.addEventListener('input',event=>{
    if(event.target.closest('#markdown-sync-settings')||event.target.id==='pocr-token')return;
    if(event.target.id.startsWith('text-preview-'))return;
    const group=event.target.closest('[data-settings-group]');if(!group)return;
    el(group.dataset.settingsGroup==='text'?'text-settings-message':'pocr-message').textContent='正在自动保存…';
  });
  tokenState();
}
pocrBindPrefs();
