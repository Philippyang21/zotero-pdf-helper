'use strict';
window.addEventListener('load',()=>{
  const tools=window.arguments[0].tools,el=id=>document.getElementById(id);
  const refresh=()=>{
    const options=tools.getOptions();
    el('text-mode').textContent=options.enabled ? '当前规则：'+({paper:'论文引用',light:'轻度整理',custom:'自定义'}[options.preset]) : '引用文本整理已关闭，将保留原文。';
    el('text-output').value=tools.process(el('text-input').value,options);
  };
  window.refreshText=refresh;el('text-input').addEventListener('input',refresh);
  for(const [id,rawOnly] of [['text-copy',false],['text-original',true]])el(id).addEventListener('click',()=>{
    try{tools.copy(el('text-input').value,rawOnly);el('text-message').textContent='已复制到剪贴板';}
    catch(e){el('text-message').textContent=e.message;}
  });
  el('text-settings').addEventListener('click',()=>tools.app.showPreferences());refresh();
});
