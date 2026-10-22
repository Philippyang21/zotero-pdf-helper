'use strict';
var RepairProgress = (()=>{
  const labels={queued:'排队中',preparing:'准备中',recognizing:'云端识别中',generating:'本地生成中',ready:'等待保存',committing:'替换中',committed:'更新 Zotero 中',done:'已完成',failed:'处理失败',paused:'已暂停',cancelled:'已取消',retained:'已生成，未替换'};
  const stages={waiting:'等待本地 PDF 处理',writing:'写入不可见文字层',saving:'保存 PDF 文件',checking:'校验 PDF 文字层',backup:'核对与保存备份',replacing:'替换原 PDF',indexing:'更新 Zotero 同步与全文索引',sidecars:'收纳 MD/JSON',applying:'校验、备份与替换',splitting:'准备 OCR 页段',remote:'等待云端解析结果'};
  const partLabels={new:'待提交',intent:'上传回执待确认',accepted:'等待云端状态',uploading:'上传中',waiting:'查询云端状态',pending:'云端排队中',running:'云端解析中',downloading:'下载识别结果',done:'结果已下载',rejected:'提交被拒绝'};
  function duration(seconds) {
    const n=Math.max(0,Math.floor(Number(seconds)||0));
    return n<60 ? `${n} 秒` : n<3600 ? `${Math.floor(n/60)} 分 ${n%60} 秒` : `${Math.floor(n/3600)} 小时 ${Math.floor(n%3600/60)} 分`;
  }
  function timing(job) {
    const totals={uploading:0,pending:0,running:0,downloading:0,waiting:0};
    for(const part of job.parts||[])for(const k of Object.keys(totals))totals[k]+=Number(part.timing?.[k])||0;
    return `上传 ${duration(totals.uploading)} · 排队 ${duration(totals.pending)} · 解析 ${duration(totals.running)} · 下载 ${duration(totals.downloading)} · 查询等待 ${duration(totals.waiting)}\n云端流程用时 ${duration(job.apiSeconds)} · 本机 PDF ${duration(job.pdfSeconds)}`;
  }
  function segments(job) {
    return (job.parts||[]).map((part,i)=>{
      const done=part.state==='done', phase=done ? 'done' : part.phase||part.state;
      const p=part.remoteProgress, total=part.end-part.start;
      const known=done || !!p;
      let label=partLabels[phase]||'等待状态';
      if(['paused','failed','cancelled'].includes(job.state)&&!done)label=`已停止等待 · 上次${label}`;
      const count=done ? total : p?.completed;
      const elapsed=Object.values(part.timing||{}).reduce((sum,n)=>sum+(Number(n)||0),0);
      const age=part.lastChecked ? Math.max(0,(Date.now()-Date.parse(part.lastChecked))/1000) : null;
      return {number:i+1,range:`${part.start+1}–${part.end}`,label,known,count,total,
        text:known ? `${count} / ${total} 页` : phase==='new' ? '尚未提交' : '云端未返回页数',
        elapsed:part.timing ? duration(elapsed) : part.state==='new' ? '尚未开始' : '此前未记录',
        checked:done ? '已完成' : age===null ? '尚未查询' : `${duration(age)}前`};
    });
  }
  function view(job,phase,error) {
    const state=job.state, p=job.progress||{};
    if (error) return {label:'需要处理',text:error,value:null,tone:'error',stage:'error'};
    if (state==='done' || state==='retained') return {label:job.restored ? '已恢复原始 PDF' : labels[state],
      text:job.restored ? '识别结果与生成文件仍保留' : state==='retained' ? '可检索 PDF 已生成；原附件尚未替换' : job.indexPending ? 'PDF 已替换；全文索引待重建，原始备份可恢复' : 'PDF 已替换，Zotero 更新完成；原始备份可恢复',value:100,tone:'success',stage:'complete'};
    if (['failed','paused','cancelled'].includes(state)) return {label:labels[state],text:job.message,value:null,tone:state==='failed' ? 'error' : 'paused',stage:state};
    const stage=phase || (state==='generating' || state==='recognizing' || state==='committing' ? p.stage : state==='committed' ? 'indexing' : state);
    if(stage==='remote'){
      const parts=segments(job), known=p.known===true || (p.completed||0)>0;
      const complete=p.completed||0, percent=job.pages ? Math.floor(complete*1000/job.pages)/10 : 0;
      const unavailable=parts.some(s=>!s.known && !/尚未提交/.test(s.text));
      const text=`云端已解析${unavailable&&known ? '至少' : ''} ${complete} / ${job.pages} 页${known ? ` · ${percent}%（识别阶段）` : '；正在等待云端页数'}；已下载 ${p.resultPages??complete} 页结果`;
      const active=parts.filter(s=>!['结果已下载','待提交'].includes(s.label));
      const label=active.length ? active.map(s=>`第 ${s.number}/${parts.length} 段：${s.label}`).join('；') : stages.remote;
      return {label,text,value:known ? percent : null,tone:'active',stage};
    }
    const counted=!phase && ['writing','checking'].includes(stage) && p.total>0;
    const text=counted ? `${p.completed} / ${p.total} 页 · ${Math.floor(p.completed*100/p.total)}%（当前阶段）` :
      stage==='remote' ? `已取得 ${p.completed||0} / ${job.pages} 页结果；当前页段尚无逐页进度` : job.message||'正在处理…';
    return {label:stages[stage]||labels[state]||state,text,value:counted ? p.completed*100/p.total : null,tone:'active',stage};
  }
  return {view,labels,segments,timing,duration};
})();
