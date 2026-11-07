/* global Zotero, document */
'use strict';
var pocrMarkdownPrefAttempts=0;
function pocrBindMarkdownPrefs(){
  const root=document.getElementById('markdown-sync-settings');
  if(!root){if(++pocrMarkdownPrefAttempts<100)setTimeout(pocrBindMarkdownPrefs,50);return;}
  if(root.dataset.bound)return;root.dataset.bound='1';
  const app=Zotero.PaddleOCRRepair,sync=app?.markdownSync,el=id=>document.getElementById('markdown-sync-'+id);
  const controls=['pdf','md','refresh','enable','now','stop'];
  if(!sync?.ready){for(const id of controls)el(id).disabled=true;el('status').textContent='Markdown 高亮同步暂未载入，请重启 Zotero。';return;}
  let busy=false,pdfs=new Map(),markdowns=new Map();
  function options(select,items,empty){
    select.replaceChildren();
    for(const [value,label] of items.length?items:[['',empty]]){
      const option=document.createElementNS('http://www.w3.org/1999/xhtml','option');
      option.value=value;option.textContent=label;select.appendChild(option);
    }
  }
  function paint(){
    const pdf=pdfs.get(el('pdf').value),binding=pdf&&sync.bindings[sync.key(pdf)],md=markdowns.get(el('md').value);
    for(const id of controls)el(id).disabled=busy;
    el('pdf').disabled=busy||!pdfs.size;el('md').disabled=busy||!markdowns.size;
    el('enable').disabled=busy||!pdf||!md;
    el('now').disabled=busy||!binding||binding.mdKey!==md?.key;
    el('stop').disabled=busy||!binding;
    el('enable').textContent=binding?'保存关联并同步':'开启自动同步';
    if(busy)return;
    el('status').textContent=!pdf?'请先在文库中选中 PDF，或打开 PDF 阅读器，再刷新列表。':
      binding&&md&&md.key!==binding.mdKey?'此 PDF 正在同步到原关联的 MD。要改用当前选择的 MD，请点击“保存关联并同步”。':
      binding?'此 PDF 已开启自动同步。新增、修改和删除高亮会更新关联的 MD。':
      !md?'同条目下没有可选的 MD，请先添加对应附件；识别资料放在独立存档时，请先收纳到原文献下。':
      '此 PDF 尚未开启自动同步。确认对应 MD 后，点击“开启自动同步”。';
  }
  function loadMarkdown(){
    markdowns=new Map();
    const pdf=pdfs.get(el('pdf').value),binding=pdf&&sync.bindings[sync.key(pdf)],parent=pdf?.parentID&&Zotero.Items.get(pdf.parentID);
    if(parent&&!parent.deleted)for(const id of parent.getAttachments()){
      const child=Zotero.Items.get(id);
      if(child&&!child.deleted&&/\.md$/i.test(child.attachmentFilename||''))markdowns.set(child.key,child);
    }
    const children=[...markdowns.values()];
    options(el('md'),[['','请选择对应的 MD 附件'],...children.map(md=>[md.key,md.attachmentFilename+' ['+md.key+']'])],'同条目下没有 MD 附件');
    const stem=name=>String(name||'').replace(/\.pdf$|(?:\.ocr)?\.md$/ig,'');
    const exact=children.filter(md=>stem(md.attachmentFilename)===stem(pdf?.attachmentFilename));
    el('md').value=binding&&markdowns.has(binding.mdKey)?binding.mdKey:exact.length===1?exact[0].key:children.length===1?children[0].key:'';
    paint();
  }
  function refresh(preferCurrent=false){
    const previous=el('pdf').value,previousPDF=pdfs.get(previous);pdfs=new Map();
    const add=pdf=>{if(pdf&&!pdf.deleted&&pdf.isAttachment()&&pdf.attachmentReaderType==='pdf')pdfs.set(sync.key(pdf),pdf);};
    const win=Zotero.getMainWindow();
    const reader=win?.Zotero_Tabs?.selectedID&&Zotero.Reader?.getByTabID(win.Zotero_Tabs.selectedID);
    if(reader)add(Zotero.Items.get(reader.itemID));
    if(win)for(const pdf of app.selected(win))add(pdf);
    const current=[...pdfs.keys()][0];
    for(const binding of Object.values(sync.bindings))add(sync.pdf(binding));
    // Keep the current PDF available after stopping its only binding.
    add(previousPDF);
    options(el('pdf'),[...pdfs].map(([key,pdf])=>[key,pdf.attachmentFilename+' ['+pdf.key+']']),'没有可用的 PDF');
    el('pdf').value=preferCurrent&&current?current:pdfs.has(previous)?previous:current||[...pdfs.keys()][0]||'';
    loadMarkdown();
  }
  function action(fn){return async()=>{
    if(busy)return;
    busy=true;paint();el('status').textContent='正在处理…';
    try{const message=await fn();busy=false;refresh();if(message)el('status').textContent=message;}
    catch(e){busy=false;paint();el('status').textContent=e.message||'操作未完成，请重试。';}
  };}
  el('pdf').addEventListener('change',loadMarkdown);el('md').addEventListener('change',paint);
  el('refresh').addEventListener('click',()=>{try{refresh(true);}catch(e){el('status').textContent=e.message;}});
  el('enable').addEventListener('click',action(async()=>{
    const pdf=pdfs.get(el('pdf').value),md=markdowns.get(el('md').value);
    return await sync.enable(pdf,window,md)?'已开启自动同步，当前高亮已同步到所选 MD。':'已取消，未更改同步设置。';
  }));
  el('now').addEventListener('click',action(async()=>{
    const result=await sync.sync(pdfs.get(el('pdf').value));
    return `已同步 ${result.total} 条摘录，其中 ${result.matched} 条已在正文标记。`;
  }));
  el('stop').addEventListener('click',action(async()=>{
    await sync.stop(pdfs.get(el('pdf').value));return '已停止此 PDF 的自动同步，MD 中现有标记保留。';
  }));
  try{refresh(true);}catch(e){el('status').textContent=e.message;}
}
pocrBindMarkdownPrefs();
