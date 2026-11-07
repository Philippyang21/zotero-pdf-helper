/* global Zotero, document */
'use strict';
var pocrMarkdownPrefAttempts=0;
function pocrBindMarkdownPrefs(){
  const root=document.getElementById('markdown-sync-settings');
  if(!root){if(++pocrMarkdownPrefAttempts<100)setTimeout(pocrBindMarkdownPrefs,50);return;}
  if(root.dataset.bound)return;root.dataset.bound='1';
  const sync=Zotero.PaddleOCRRepair?.markdownSync;
  const toggle=document.getElementById('markdown-sync-enabled'),status=document.getElementById('markdown-sync-status');
  if(!sync?.ready){toggle.disabled=true;status.textContent='Markdown 高亮同步暂未载入，请重启 Zotero。';return;}
  let saving=false;
  function paint(){
    toggle.checked=sync.enabled;toggle.disabled=saving;
    if(!sync.enabled){status.textContent='已关闭自动同步，MD 中现有高亮标记保留。';return;}
    const value=sync.status;
    status.textContent=value.running?`正在同步所有文献：已同步 ${value.synced} 个 PDF…`:
      '已开启：所有文献条目自动同步高亮到同条目下标题相同或相近的 MD 附件。';
    if(value.failed)status.textContent+=` ${value.failed} 个文档暂未完成，请检查附件是否已下载且可写。`;
  }
  const unsubscribe=sync.subscribe(paint);
  window.addEventListener('unload',unsubscribe,{once:true});
  toggle.addEventListener('change',async()=>{
    if(saving)return;
    const enabled=toggle.checked;saving=true;toggle.disabled=true;
    try{await sync.setEnabled(enabled);saving=false;paint();}
    catch(e){saving=false;paint();status.textContent=e.message||'设置未能保存，请重试。';}
  });
  paint();
}
pocrBindMarkdownPrefs();
