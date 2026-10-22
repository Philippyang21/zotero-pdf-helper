'use strict';
var app, selectedID;
const el=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const n=document.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const selected=()=>app?.state.jobs.find(j=>j.id===selectedID);
function bar(view) {
  const p=node('progress');p.max=100;
  if(view.value!==null)p.value=view.value;
  p.setAttribute('aria-label',view.label+'：'+view.text);return p;
}
function render(state) {
  if(!app)return;
  const jobs=[...state.jobs].reverse();
  if(app.focusJobID){selectedID=app.focusJobID;app.focusJobID=null;}
  if(!selectedID || !jobs.some(j=>j.id===selectedID))selectedID=jobs.find(j=>!['done','retained','failed','paused','cancelled'].includes(j.state))?.id || jobs[0]?.id;
  const active=jobs.filter(j=>!['done','retained','failed','paused','cancelled'].includes(j.state)).length;
  const done=jobs.filter(j=>['done','retained'].includes(j.state) && !j.restored).length;
  const attention=jobs.filter(j=>['failed','paused'].includes(j.state) || app.finalizeErrors.has(j.id)).length;
  el('summary').textContent=`处理中 ${active} · 已完成/已生成 ${done} · 待处理 ${attention}`;
  el('busy').hidden=!app.busyMessage;
  el('busy-text').textContent=app.busyMessage||'';
  el('quota-status').textContent='账户已用 / 剩余额度：未知（未接入官方查询）';
  el('usage').textContent='本插件今日提交记录：'+(Object.entries(state.usage||{}).map(([model,u])=>`${model} 获得任务 ID ${u.accepted} 页，回执待确认 ${u.uncertain} 页`).join('；') || '尚无提交')+`。本地提醒阈值 ${state.dailyThreshold||20000} 页。提交页数不代表实际消耗，且不包含其他客户端。`;
  el('jobs').replaceChildren();
  for(const job of jobs){
    const view=RepairProgress.view(job,app.finalizePhase.get(job.id),app.finalizeErrors.get(job.id));
    const row=node('tr');row.className=(selectedID===job.id ? 'selected ' : '')+view.tone;
    row.tabIndex=0;row.setAttribute('aria-selected',String(selectedID===job.id));
    const name=node('td');name.append(node('strong',job.target.split(/[\\/]/).pop()),node('div',`${job.pages} 页 · ${job.mode==='merge' ? '合并已有结果 · OCR 0 页' : job.model}`,'muted'));
    const status=node('td');status.append(node('span',view.label,'badge '+view.tone));
    const progress=node('td');progress.append(bar(view),node('div',view.text,'muted'));
    const time=node('td',RepairProgress.timing(job),'timing');
    row.append(name,status,progress,time);
    const choose=()=>{selectedID=job.id;render(state);};row.onclick=choose;row.onkeydown=e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();choose();}};
    el('jobs').append(row);
  }
  el('empty').hidden=jobs.length>0;
  const job=selected();el('selected-panel').hidden=!job;
  for(const id of ['resume','cancel','apply','open','sidecars','organize','archive'])el(id).disabled=!job;
  if(!job)return;
  el('resume').disabled=!['failed','paused','cancelled'].includes(job.state);
  el('cancel').disabled=!['queued','preparing','recognizing','generating','ready'].includes(job.state);
  el('apply').disabled=!['ready','committed'].includes(job.state);
  el('open').disabled=!job.output;el('sidecars').disabled=!job.json;
  el('organize').disabled=!['done','retained'].includes(job.state);
  const view=RepairProgress.view(job,app.finalizePhase.get(job.id),app.finalizeErrors.get(job.id));
  const panel=el('selected-panel');panel.className='card '+view.tone;
  el('selected-title').textContent=(view.tone==='success' ? '✓ ' : view.tone==='error' ? '! ' : '')+view.label;
  el('selected-name').textContent=job.target.split(/[\\/]/).pop();
  el('selected-progress').replaceChildren(bar(view));el('selected-caption').textContent=view.text;
  el('selected-timing').textContent=RepairProgress.timing(job);
  el('segments').replaceChildren();
  for(const part of RepairProgress.segments(job)){
    const row=node('tr');
    row.append(node('td',`第 ${part.number} 段 · ${part.range} 页`),node('td',part.label),node('td',part.text),node('td',part.elapsed),node('td',part.checked));
    el('segments').append(row);
  }
  el('segment-panel').hidden=!(job.parts||[]).length;
  el('steps').replaceChildren();
  const stepIndex={queued:0,preparing:0,splitting:0,recognizing:1,remote:1,waiting:2,generating:2,writing:2,saving:3,checking:3,ready:3,sidecars:3,applying:3,backup:3,replacing:3,committing:3,indexing:3,committed:3,complete:4}[view.stage];
  for(const [i,text] of ['准备','识别 / 复用','写入文字','保存与更新','完成'].entries())el('steps').append(node('span',text,i===stepIndex ? 'current' : i<stepIndex ? 'passed' : ''));
  const receipt=app.receipts[job.id]||{};
  const storage={archive:'独立存档条目（Zotero 文件同步）',hidden:'插件本地隐藏目录（不随库同步）',import:'原文献下的存储附件',link:'原文献下的链接附件（文件不随库同步）'}[receipt.storage||job.sidecars]||job.sidecars;
  el('detail').textContent=[job.message,app.finalizeErrors.get(job.id)||'',
    'MD/JSON 保存：'+storage,'PDF：'+job.target,'任务：'+job.id,'JSON：'+(job.json||'结果尚未就绪'),
    'Markdown：'+(job.md||'结果尚未就绪'),'原始备份：'+(job.backup||'成功替换前创建'),
    ...(job.parts||[]).map((p,i)=>`页段 ${i+1} [${p.start+1}–${p.end}] batch=${p.batchID} job=${p.remoteID||'未确认'} ${p.state}`),
    ...(job.report?.warnings||[])].filter(Boolean).join('\n');
}
window.render=render;
window.showSetup=message=>{el('busy').hidden=false;el('busy-text').textContent=message;};
window.addEventListener('load',async()=>{
  app=window.arguments[0].repair;
  const action=fn=>async()=>{try{el('message').textContent='';await fn();}catch(e){el('message').textContent=e.message;}};
  const requireJob=()=>{const job=selected();if(!job)throw new Error('请先选择一个任务');return job;};
  el('settings').onclick=()=>app.showPreferences();
  el('refresh').onclick=action(async()=>{await app.ensure();await app.tick();render(app.state);});
  el('resume').onclick=action(async()=>{await app.jobAction(requireJob().id,'resume');});
  el('cancel').onclick=action(async()=>{await app.jobAction(requireJob().id,'cancel');});
  el('apply').onclick=action(async()=>{const job=requireJob();app.finalizeErrors.delete(job.id);await app.finalize(job);await app.tick();});
  el('open').onclick=action(async()=>{const job=requireJob();if(!job.output)throw new Error('尚未生成 PDF');app.openPath(job.output);});
  el('sidecars').onclick=action(async()=>{const job=requireJob();if(!job.json)throw new Error('识别结果尚未就绪');app.openPath(app.resultFolder(job));});
  el('organize').onclick=action(async()=>{await app.organizeSidecars(requireJob());el('message').textContent='MD/JSON 已收纳，PDF 无需重新转换。';render(app.state);});
  el('archive').onclick=action(async()=>{await app.showArchive(requireJob());});
  el('folder').onclick=()=>app.openPath(app.data);
  el('quota').onclick=()=>app.openQuota();el('quota-rules').onclick=()=>app.openQuotaRules();
  el('bind').onclick=action(async()=>{
    const job=requireJob();const part=window.prompt('填写页段编号（从 1 开始）','1');if(part===null)return;
    const index=Number(part)-1;if(!Number.isInteger(index)||!job.parts[index])throw new Error('页段编号无效');
    const id=window.prompt('填写 AI Studio 中已提交的任务 ID。不会发起新的 OCR 请求。','');
    if(id?.trim())await app.jobAction(job.id,'resume',{remoteIDs:{[index]:id.trim()}});
  });
  render(app.state);
  await action(async()=>{await app.ensure();await app.tick();render(app.state);})();
});
