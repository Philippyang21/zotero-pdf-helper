/* global Zotero */
'use strict';
var pocrUpdateAttempts=0;
function pocrBindUpdatePrefs() {
  const root=document.getElementById('pocr-page-updates');
  if(!root){if(++pocrUpdateAttempts<100)setTimeout(pocrBindUpdatePrefs,50);return;}
  if(root.dataset.bound)return;root.dataset.bound='1';
  const app=Zotero.PaddleOCRRepair,el=id=>document.getElementById(id);
  const check=el('pocr-update-check'),download=el('pocr-update-download'),status=el('pocr-update-status');
  let result=null,busy=false,disposed=false;
  el('pocr-update-version').textContent=app.version ? '当前安装版本：v'+app.version : '无法获取当前安装版本。';
  const error=e=>{
    result=null;download.hidden=true;el('pocr-update-details').hidden=true;
    status.textContent=e?.code==='not-configured' ? '检查更新尚未配置。请等待发布者提供更新信息源和中文社区详情页。' :
      '暂时无法获取更新信息，请检查网络后重试。';
    check.textContent='重试';
  };
  check.addEventListener('click',async()=>{
    if(busy || disposed)return;
    busy=true;result=null;check.disabled=true;download.hidden=true;el('pocr-update-details').hidden=true;
    root.setAttribute('aria-busy','true');status.textContent='正在检查更新……';check.textContent='正在检查更新……';
    try {
      if(!app.updates)throw new Error('unavailable');
      const next=await app.updates.check();if(disposed)return;result=next;
      check.textContent='检查更新';
      if(next.state==='current'){status.textContent='当前已是最新版本。';return;}
      status.textContent=next.state==='available' ? '发现新版本 v'+next.latestVersion+'。' :
        '当前新版本可能不支持你的 Zotero 版本，请先查看版本要求。';
      el('pocr-update-details').hidden=false;
      el('pocr-update-requirements').textContent='v'+next.latestVersion+' 需要 Zotero '+next.minZoteroVersion+
        (next.maxZoteroVersion ? ' – '+next.maxZoteroVersion : ' 及以上')+'；当前 Zotero '+next.zoteroVersion+'。';
      // Remote notes are plain text, never markup or executable links.
      el('pocr-update-notes').textContent=next.releaseNotes || '发布者未提供更新说明。';
      download.hidden=next.state!=='available';
    } catch(e) { if(!disposed)error(e); }
    finally { busy=false;if(!disposed){check.disabled=false;root.setAttribute('aria-busy','false');} }
  });
  download.addEventListener('click',async()=>{
    if(!result || busy || disposed)return;
    busy=true;download.disabled=true;check.disabled=true;
    try {
      const opened=await app.updates.openCommunity(result);
      if(!disposed)status.textContent=opened ? '已打开中文社区详情页。下载 .xpi 后，请在 Zotero 插件管理器中手动安装。' : '已取消，仍留在设置界面。';
    } catch(e) { if(!disposed)error(e); }
    finally { busy=false;if(!disposed){download.disabled=false;check.disabled=false;} }
  });
  window.addEventListener('unload',()=>{disposed=true;result=null;},{once:true});
}
pocrBindUpdatePrefs();
