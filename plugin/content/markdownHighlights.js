/* global Zotero, IOUtils, PathUtils */
'use strict';
// File-local, reversible markup plus a plain Markdown index for AI ingestion.
var PDFHelperMarkdown = (()=>{
  const safeKey=value=>/^[A-Z0-9]{1,16}$/.test(value);
  const escape=value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function strip(text,pdfKey){
    if(!safeKey(pdfKey))throw new Error('PDF 标识无效');
    const start=`<!-- pdf-helper-highlights:${pdfKey} -->`,end=`<!-- /pdf-helper-highlights:${pdfKey} -->`;
    const i=text.indexOf(start),j=text.indexOf(end);
    if(i>=0||j>=0){
      if(i<0||j<i||text.indexOf(start,i+start.length)>=0||text.indexOf(end,j+end.length)>=0)
        throw new Error('Markdown 高亮区标记不完整，请先恢复或修复该区块');
      // The two preceding newlines belong to this generated section only.
      const from=text.slice(Math.max(0,i-2),i)==='\n\n'?i-2:i;
      text=text.slice(0,from)+text.slice(j+end.length);
    }
    return text.replace(new RegExp(`<mark data-pdf-helper="${pdfKey}:[A-Z0-9,]+">([\\s\\S]*?)</mark>`,'g'),'$1');
  }
  function protectedRanges(text){
    const ranges=[];
    // Fences may contain code, Markdown examples or apparent quoted highlights.
    let pos=0,fence=null,start=0;
    for(const line of text.split(/(?<=\n)/)){
      const m=line.match(/^ {0,3}(`{3,}|~{3,})/);
      if(!fence&&m){fence=m[1];start=pos;}
      else if(fence&&m&&m[1][0]===fence[0]&&m[1].length>=fence.length){ranges.push([start,pos+line.length]);fence=null;}
      if(!fence&&/^(?: {4}|\t)/.test(line))ranges.push([pos,pos+line.length]);
      pos+=line.length;
    }
    if(fence)ranges.push([start,text.length]);
    for(const m of text.matchAll(/(`+)[\s\S]*?\1|!?(?:\[[^\]\n]*\])\([^\n]*?\)|<[^>]*>/g))ranges.push([m.index,m.index+m[0].length]);
    return ranges.sort((a,b)=>a[0]-b[0]);
  }
  function render(original,annotations,pdfKey){
    const base=strip(original,pdfKey),ranges=protectedRanges(base),offsets=[],chars=[];
    let range=0;
    for(let i=0;i<base.length;i++){
      while(range<ranges.length&&ranges[range][1]<=i)range++;
      if(range<ranges.length&&ranges[range][0]<=i){chars.push('\u0000');offsets.push(i);i=Math.max(i,ranges[range][1]-1);continue;}
      if(!/\s/.test(base[i])){chars.push(base[i]);offsets.push(i);}
    }
    const normalized=chars.join(''),matches=[],entries=[];
    const sorted=[...annotations].filter(a=>safeKey(a.key)&&String(a.text||'').trim())
      .sort((a,b)=>String(a.sortIndex||'').localeCompare(String(b.sortIndex||''))||String(a.key).localeCompare(String(b.key)));
    for(const a of sorted){
      const needle=String(a.text).replace(/\s/g,''),first=normalized.indexOf(needle);
      const unique=needle.length>=2&&first>=0&&normalized.indexOf(needle,first+1)<0;
      if(unique)matches.push({start:offsets[first],end:offsets[first+needle.length-1]+1,keys:[a.key]});
      entries.push({a,matched:unique});
    }
    matches.sort((a,b)=>a.start-b.start||a.end-b.end);
    const merged=[];
    for(const m of matches){
      const last=merged[merged.length-1];
      if(last&&m.start<last.end){last.end=Math.max(last.end,m.end);last.keys.push(...m.keys);}
      else merged.push({...m});
    }
    let text=base;
    for(const m of merged.reverse())text=text.slice(0,m.start)+`<mark data-pdf-helper="${pdfKey}:${[...new Set(m.keys)].join(',')}">`+text.slice(m.start,m.end)+'</mark>'+text.slice(m.end);
    if(entries.length){
      const lines=[`<!-- pdf-helper-highlights:${pdfKey} -->`,'## PDF 高亮摘录',
        '以下为 Zotero PDF 中当前的高亮与下划线。正文的 <mark> 标签表示对应高亮；未唯一匹配的摘录也完整保留在此。'];
      for(const {a,matched} of entries){
        lines.push('',`### 第 ${escape(a.page||'?')} 页 · ${a.type==='underline'?'下划线':'高亮'} · ${a.key}`,
          `- 注释 ID：${a.key}；颜色：${escape(a.color)}；正文定位：${matched?'已标记':'未唯一匹配，仅收录摘录'}`,
          ...String(a.text).split(/\r?\n/).map(line=>'> '+escape(line)));
        if(a.comment)lines.push('',...String(a.comment).split(/\r?\n/).map(line=>'> 批注：'+escape(line)));
      }
      lines.push(`<!-- /pdf-helper-highlights:${pdfKey} -->`);
      text+='\n\n'+lines.join('\n');
    }
    return {text,total:entries.length,matched:entries.filter(e=>e.matched).length};
  }
  return {render,strip};
})();

var PDFHelperMarkdownSync = class {
  constructor(app){
    this.app=app;this.bindings={};this.parents=new Map();this.timers=new Map();this.queues=new Map();this.failed=new Set();this.closed=false;this.ready=false;
    this.path=PathUtils.join(app.data,'markdown-highlights.json');
  }
  key(pdf){return pdf.libraryID+':'+pdf.key;}
  pdf(binding){return Zotero.Items.getByLibraryAndKey(binding.libraryID,binding.pdfKey);}
  async init(){
    if(await IOUtils.exists(this.path)){
      const saved=await IOUtils.readJSON(this.path);
      if(saved.schema!==1||!saved.bindings||typeof saved.bindings!=='object')throw new Error('Markdown 同步设置损坏');
      this.bindings=saved.bindings;
    }
    this.observer=Zotero.Notifier.registerObserver({notify:(...args)=>this.notify(...args)},['item'],'pdf-helper-markdown');
    this.ready=true;
    for(const binding of Object.values(this.bindings)){
      const pdf=this.pdf(binding);
      if(pdf&&!pdf.deleted){this.snapshot(pdf);this.schedule(pdf);}
    }
  }
  persist(){
    this.persistence=(this.persistence||Promise.resolve()).catch(()=>{}).then(()=>
      IOUtils.writeJSON(this.path,{schema:1,bindings:this.bindings},{tmpPath:this.path+'.tmp'}));
    return this.persistence;
  }
  snapshot(pdf){
    return pdf.getAnnotations().filter(a=>!a.deleted&&['highlight','underline'].includes(a.annotationType)).map(a=>{
      this.parents.set(a.id,pdf.id);
      return {key:a.key,text:a.annotationText,page:a.annotationPageLabel,color:a.annotationColor,
        comment:a.annotationComment,type:a.annotationType,sortIndex:a.annotationSortIndex};
    });
  }
  notify(event,type,ids){
    if(this.closed||type!=='item'||!['add','modify','delete','trash'].includes(event))return;
    // Do not await writes from a Notifier callback: saveTx also notifies observers.
    for(const id of ids){
      // get() throws for an erased ID on native Zotero (it is not just false).
      let item;try{item=Zotero.Items.get(id);}catch(_){item=null;}
      // Erase can leave a cached annotation whose parentID has already cleared.
      const parentID=(item&&item.isAnnotation()&&item.parentID)||this.parents.get(id);
      const pdf=parentID&&Zotero.Items.get(parentID);
      if(pdf&&this.bindings[this.key(pdf)]){this.parents.set(id,parentID);this.schedule(pdf);}
    }
  }
  schedule(pdf){
    const key=this.key(pdf);clearTimeout(this.timers.get(key));
    this.timers.set(key,setTimeout(()=>{
      this.timers.delete(key);
      this.sync(pdf).catch(()=>{
        Zotero.logError(new Error('Markdown 高亮同步未完成，请在设置的“高亮与复制”中重试。'));
        if(!this.failed.has(key)){this.failed.add(key);this.app.notify('Markdown 高亮同步未完成，请检查附件是否已下载、文库是否可写，再到设置 → 高亮与复制中重试。',10000);}
      });
    },400));
  }
  sync(pdf){
    const key=this.key(pdf),previous=this.queues.get(key)||Promise.resolve();
    const action=previous.catch(()=>{}).then(()=>this.write(pdf));this.queues.set(key,action);
    action.finally(()=>{if(this.queues.get(key)===action)this.queues.delete(key);}).catch(()=>{});
    return action;
  }
  async write(pdf){
    const key=this.key(pdf),binding=this.bindings[key];if(!binding||this.closed)return;
    const md=Zotero.Items.getByLibraryAndKey(binding.libraryID,binding.mdKey);
    const library=Zotero.Libraries.get(pdf.libraryID);
    if(pdf.deleted||!pdf.isAttachment()||pdf.attachmentReaderType!=='pdf'||!md||!md.isAttachment()||md.deleted||
        !pdf.parentID||md.parentID!==pdf.parentID||!library.editable||!library.filesEditable||!md.isEditable())
      throw new Error('PDF / Markdown 关联或文库权限已变化');
    const path=await md.getFilePathAsync();
    if(!path||!await IOUtils.exists(path)||! /\.md$/i.test(path))throw new Error('Markdown 附件尚未下载或已丢失');
    const bytes=await IOUtils.read(path);
    const original=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    const result=PDFHelperMarkdown.render(original,this.snapshot(pdf),pdf.key);
    if(result.text!==original){
      const backupDir=PathUtils.join(this.app.data,'markdown-backups');
      await IOUtils.makeDirectory(backupDir,{ignoreExisting:true});
      const backup=PathUtils.join(backupDir,md.libraryID+'-'+md.key+'.md');
      if(!await IOUtils.exists(backup))await IOUtils.copy(path,backup,{noOverwrite:true});
      // A concurrent external edit wins; retry from the current file next time.
      const current=await IOUtils.read(path);
      if(current.length!==bytes.length||current.some((v,i)=>v!==bytes[i]))throw new Error('Markdown 正被其他程序修改，请重试');
      if(this.closed||this.bindings[key]!==binding)return;
      await IOUtils.writeUTF8(path,result.text,{tmpPath:path+'.pdf-helper.tmp'});
    }
    // Also retry this flag after a prior saveTx failure, even when bytes match.
    if(!md.isLinkedFileAttachment()){
      md.attachmentSyncState=Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD;
      await md.saveTx({skipSelect:true});
    }
    this.failed.delete(key);return result;
  }
  async enable(pdf,win,markdown){
    if(!this.ready||this.closed)throw new Error('Markdown 同步尚未就绪，请检查同步设置文件或重启 Zotero');
    const parent=Zotero.Items.get(pdf.parentID);
    if(!parent||parent.deleted)throw new Error('请先将 PDF 与对应 MD 放在同一文献条目下');
    const children=parent.getAttachments().map(id=>Zotero.Items.get(id)).filter(i=>i&&!i.deleted&&/\.md$/i.test(i.attachmentFilename||''));
    if(!children.length)throw new Error('条目下没有 MD 附件。请先添加对应 Markdown，或将识别资料收纳到原文献下');
    const stem=name=>name.replace(/\.pdf$|(?:\.ocr)?\.md$/ig,'');
    const exact=children.filter(i=>stem(i.attachmentFilename)===stem(pdf.attachmentFilename));
    let md=markdown||(exact.length===1?exact[0]:children.length===1?children[0]:null);
    if(markdown&&!children.some(child=>child.id===markdown.id))throw new Error('请选择当前文献条目下的 MD 附件');
    if(!md){
      const selected=await this.app.chooseFile(win,'选择当前文献条目下、与此 PDF 对应的 MD 附件','md');
      if(!selected)return;
      for(const child of children)if(await child.getFilePathAsync()===selected)md=child;
      if(!md)throw new Error('请选择已经添加在当前文献条目下的 MD 附件文件');
    }
    const key=this.key(pdf);
    if(Object.entries(this.bindings).some(([k,b])=>k!==key&&b.libraryID===md.libraryID&&b.mdKey===md.key))
      throw new Error('这个 MD 已关联到另一个 PDF，请为每个 PDF 使用独立的 MD');
    if(!this.app.confirm(`将当前 PDF 的高亮、下划线和批注同步到 ${md.attachmentFilename}。\n\n可唯一匹配的正文将加上 <mark> 高亮，文末附上页码与摘录。首次改写前保留原文件备份；此后新增、修改、删除注释会自动更新此 MD。是否继续？`,win))return;
    const before=this.bindings[key];
    const binding={libraryID:pdf.libraryID,pdfKey:pdf.key,mdKey:md.key};this.bindings[key]=binding;
    try{await this.sync(pdf);await this.persist();}
    catch(e){if(before)this.bindings[key]=before;else delete this.bindings[key];throw e;}
    this.app.notify('已启用 Markdown 高亮同步。后续注释变化会自动保存到此 MD。');
    return true;
  }
  async stop(pdf){
    if(!this.ready||this.closed)throw new Error('Markdown 同步尚未就绪');
    delete this.bindings[this.key(pdf)];clearTimeout(this.timers.get(this.key(pdf)));
    await this.persist();this.app.notify('已停止此 PDF 的自动同步，MD 中现有高亮保留。');
  }
  async close(){
    for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
    if(this.observer)Zotero.Notifier.unregisterObserver(this.observer);
    // Flush already scheduled annotation changes before disabling.
    const jobs=Object.values(this.bindings).map(b=>this.pdf(b)).filter(pdf=>pdf&&!pdf.deleted).map(pdf=>this.sync(pdf));
    await Promise.allSettled([...this.queues.values(),...jobs]);this.closed=true;
  }
};
