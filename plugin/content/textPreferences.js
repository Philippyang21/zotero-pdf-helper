'use strict';
var pocrTextPrefAttempts=0;
function pocrBindTextPrefs(){
  const root=document.getElementById('pocr-text-settings');
  if(!root){if(++pocrTextPrefAttempts<100)setTimeout(pocrBindTextPrefs,50);return;}
  if(root.dataset.bound)return;root.dataset.bound='true';
  const tools=Zotero.PaddleOCRRepair.textTools,el=id=>document.getElementById(id);
  if(!tools){el('text-settings-message').textContent='引用文本整理暂未载入，请重启 Zotero。';return;}
  const rules=[...root.querySelectorAll('[data-text-rule]')];
  const descriptions={paper:'自动整理标点、误换行和多余空格，适合中文论文引用或读书笔记。',
    light:'主要处理换行和空格，尽量少改动原文标点。',custom:'自己选择需要开启的整理规则。'};
  const modes={smart:'中文内容使用中文标点，英文内容保留英文标点。适合大多数文献摘录。',
    chinese:'将中文正文中的逗号、句号、引号、括号整理为中文格式。纯英文段落和明显引文保留。',
    english:'将正文中的中文标点整理为英文格式。适合英文材料或英文排版。',
    preserve:'不调整标点格式，只处理另外勾选的换行、空格等问题。'};
  function read(){
    const options={enabled:el('text-enabled').checked,preset:el('text-preset').value,punctuation:el('text-punctuation').value};
    for(const rule of rules)options[rule.dataset.textRule]=rule.checked;
    return options;
  }
  function paint(options){
    el('text-enabled').checked=options.enabled;el('text-preset').value=options.preset;
    el('text-punctuation').value=options.punctuation;
    for(const rule of rules)rule.checked=options[rule.dataset.textRule];
    preview();
  }
  function preview(){
    const options=read();el('text-preset-description').textContent=descriptions[options.preset];
    el('text-punctuation-description').textContent=modes[options.punctuation];
    el('text-preview-output').value=tools.process(el('text-preview-input').value,options);
    for(const field of [...rules,el('text-preset'),el('text-punctuation'),el('text-clean-new')])field.disabled=!options.enabled;
  }
  el('text-preview-input').value='朱自清认为, "诗教"是就读诗而论,\n作用显然也在政教.\n\n中国 现代 文学 史料 学\nDOI: 10.1234/abc.2026.01';
  el('text-clean-new').checked=tools.app.pref('text.cleanNewHighlights')!==false;
  paint(tools.getOptions());
  el('text-preset').addEventListener('change',()=>{
    const preset=el('text-preset').value;
    if(preset==='custom')preview();else paint({...tools.preset(preset),enabled:el('text-enabled').checked});
  });
  for(const field of [...rules,el('text-punctuation')])field.addEventListener('change',()=>{el('text-preset').value='custom';preview();});
  el('text-enabled').addEventListener('change',preview);el('text-preview-input').addEventListener('input',preview);
  el('text-save').addEventListener('click',()=>{
    try{tools.saveOptions(read(),el('text-clean-new').checked);el('text-settings-message').textContent='已保存。新高亮和手动处理选中高亮使用这些规则；已有注释不会自动改写。';}
    catch(_){el('text-settings-message').textContent='设置未能保存，请重试；原文未修改。';}
  });
  for(const [id,rawOnly] of [['text-preview-copy',false],['text-preview-original',true]])el(id).addEventListener('click',()=>{
    try{tools.copy(el('text-preview-input').value,rawOnly,read());el('text-settings-message').textContent='已复制到剪贴板';}
    catch(e){el('text-settings-message').textContent=e.message;}
  });
}
pocrBindTextPrefs();
