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
  const isPDF=item=>!!item&&!item.deleted&&item.isAttachment()&&item.attachmentReaderType==='pdf';
  const isMD=item=>!!item&&!item.deleted&&item.isAttachment()&&/\.md$/i.test(item.attachmentFilename||'');
  function names(item){
    return [...new Set([item.attachmentFilename,item.getField?.('title')].filter(Boolean).map(value=>
      String(value).normalize('NFKC').toLowerCase().replace(/\.(?:pdf|md)$/i,'')
        .replace(/\s*[\[(][^\])]*(?:z[- .]?lib|1lib)[^\])]*[\])]/gi,'')
        .replace(/[._\s-]*(?:ocr|markdown|识别结果|文字识别结果)$/i,'').replace(/[^\p{L}\p{N}]/gu,'')))].filter(Boolean);
  }
  function similarity(a,b){
    if(a===b)return 1;
    const short=a.length<=b.length?a:b,long=a.length>b.length?a:b;
    if(short.length<4)return 0;
    if(long.includes(short))return short.length/long.length>=.6?.93:0;
    const grams=value=>{const out=new Set();for(let i=0;i<value.length-1;i++)out.add(value.slice(i,i+2));return out;};
    const x=grams(a),y=grams(b),common=[...x].filter(g=>y.has(g)).length;
    let result=2*common/(x.size+y.size);
    if(long.length<=200&&short.length/long.length>=.65){
      let row=Array.from({length:b.length+1},(_,i)=>i);
      for(let i=1;i<=a.length;i++){
        const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));
        row=next;
      }
      result=Math.max(result,1-row[b.length]/long.length);
    }
    return result;
  }
  const score=(pdf,md)=>Math.max(0,...names(pdf).flatMap(a=>names(md).map(b=>similarity(a,b))));
  function matchAttachment(pdf,siblings,bindings={}){
    if(!isPDF(pdf))return null;
    const pdfs=siblings.filter(isPDF),markdowns=siblings.filter(isMD);
    const previous=bindings[pdf.libraryID+':'+pdf.key];
    const old=markdowns.find(md=>md.key===previous?.mdKey);
    const claimed=md=>Object.values(bindings).some(b=>b.libraryID===pdf.libraryID&&b.pdfKey!==pdf.key&&b.mdKey===md.key&&pdfs.some(p=>p.key===b.pdfKey));
    if(old&&!claimed(old))return old;
    const ranked=markdowns.map(md=>({md,score:score(pdf,md)})).filter(v=>v.score>=.78).sort((a,b)=>b.score-a.score);
    if(!ranked.length||(ranked[1]&&ranked[0].score-ranked[1].score<.05))return null;
    const best=ranked[0];
    if(pdfs.some(other=>other.id!==pdf.id&&score(other,best.md)>=best.score-.05))return null;
    if(claimed(best.md))return null;
    return best.md;
  }
  return {render,strip,isPDF,isMD,matchAttachment};
})();

var PDFHelperMarkdownSync = class {
  constructor(app){
    this.app=app;this.bindings={};this.parents=new Map();this.attachmentParents=new Map();this.documents=new Map();
    this.timers=new Map();this.queues=new Map();this.failed=new Set();this.closed=false;this.ready=false;this.enabled=false;
    this.generation=0;this.listeners=new Set();this.dirty=new Set();this.status={running:false,synced:0,skipped:0,failed:0};
    this.path=PathUtils.join(app.data,'markdown-highlights.json');
  }
  key(pdf){return pdf.libraryID+':'+pdf.key;}
  pdf(binding){return Zotero.Items.getByLibraryAndKey(binding.libraryID,binding.pdfKey);}
  async init(){
    if(await IOUtils.exists(this.path)){
      const saved=await IOUtils.readJSON(this.path);
      if(![1,2].includes(saved.schema)||!saved.bindings||typeof saved.bindings!=='object'||Array.isArray(saved.bindings)||
          (saved.schema===2&&typeof saved.enabled!=='boolean'))throw new Error('Markdown 同步设置损坏');
      this.bindings=saved.bindings;
      this.enabled=saved.schema===1?Object.keys(this.bindings).length>0:saved.enabled;
      if(saved.schema===1)await this.persist();
    }
    this.observer=Zotero.Notifier.registerObserver({notify:(...args)=>this.notify(...args)},['item','file'],'pdf-helper-markdown');
    this.ready=true;
    if(this.enabled)this.scan();
  }
  persist(){
    this.persistence=(this.persistence||Promise.resolve()).catch(()=>{}).then(()=>
      IOUtils.writeJSON(this.path,{schema:2,enabled:this.enabled,bindings:this.bindings},{tmpPath:this.path+'.tmp'}));
    return this.persistence;
  }
  snapshot(pdf){
    return pdf.getAnnotations().filter(a=>!a.deleted&&['highlight','underline'].includes(a.annotationType)).map(a=>{
      this.parents.set(a.id,pdf.id);
      return {key:a.key,text:a.annotationText,page:a.annotationPageLabel,color:a.annotationColor,
        comment:a.annotationComment,type:a.annotationType,sortIndex:a.annotationSortIndex};
    });
  }
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  emit(){for(const listener of this.listeners)try{listener();}catch(_){} }
  async setEnabled(value){
    if(!this.ready||this.closed)throw new Error('Markdown 同步尚未就绪，请重启 Zotero');
    const before=this.enabled;this.enabled=!!value;this.generation++;
    if(!this.enabled){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
    try{await this.persist();}catch(e){this.enabled=before;this.emit();if(before)this.scan();throw e;}
    this.emit();if(this.enabled)this.scan();
  }
  scan(){
    const generation=this.generation;
    if(this.scanPromise&&this.scanGeneration===generation)return this.scanPromise;
    const previous=this.scanPromise||Promise.resolve();this.scanGeneration=generation;
    const action=previous.catch(()=>{}).then(()=>this.scanAll(generation));this.scanPromise=action;
    action.catch(()=>{this.status.failed++;this.emit();}).finally(()=>{if(this.scanPromise===action)this.scanPromise=null;});
    return action;
  }
  async scanAll(generation){
    if(!this.enabled||this.closed||generation!==this.generation)return;
    this.status={running:true,synced:0,skipped:0,failed:0};this.emit();
    try{
      for(const library of Zotero.Libraries.getAll()){
        if(!library.editable||!library.filesEditable)continue;
        let items;
        try{items=await Zotero.Items.getAll(library.libraryID,false,false);}
        catch(_){this.status.failed++;this.emit();continue;}
        for(const pdf of items){
          if(!this.enabled||this.closed||generation!==this.generation)return;
          if(!PDFHelperMarkdown.isPDF(pdf)||!pdf.parentID)continue;
          try{const result=await this.sync(pdf);this.status[result?'synced':'skipped']++;}
          catch(_){this.status.failed++;}
          this.emit();
        }
      }
    }finally{this.status.running=false;this.emit();}
  }
  async prepare(pdf){
    if(pdf.loadAllData)await pdf.loadAllData();
    for(const annotation of pdf.getAnnotations())if(annotation.loadAllData)await annotation.loadAllData();
    this.snapshot(pdf);
    const parent=pdf.parentID&&await Zotero.Items.getAsync(pdf.parentID);
    if(!parent||parent.deleted)return [];
    if(parent.loadAllData)await parent.loadAllData();
    const siblings=(await Zotero.Items.getAsync(parent.getAttachments())).filter(item=>item&&!item.deleted&&item.isAttachment());
    this.documents.set(parent.id,siblings.filter(PDFHelperMarkdown.isPDF).map(item=>item.id));
    for(const item of siblings)this.attachmentParents.set(item.id,parent.id);
    return siblings;
  }
  notify(event,type,ids,extraData={}){
    if(this.closed||!this.enabled||!((type==='item'&&['add','modify','delete','trash','refresh'].includes(event))||
        (type==='file'&&['download','modify'].includes(event))))return;
    // Do not await writes from a Notifier callback: saveTx also notifies observers.
    for(const id of ids){
      if(extraData[id]?.pdfHelperMarkdown)continue;
      // get() throws for an erased ID on native Zotero (it is not just false).
      let item;try{item=Zotero.Items.get(id);}catch(_){item=null;}
      // Erase can leave a cached annotation whose parentID has already cleared.
      const parentID=(item&&item.isAnnotation()&&item.parentID)||this.parents.get(id);
      const pdf=parentID&&Zotero.Items.get(parentID);
      if(pdf&&PDFHelperMarkdown.isPDF(pdf)){this.parents.set(id,parentID);this.schedule(pdf);continue;}
      if(item&&item.isAttachment()){
        if(PDFHelperMarkdown.isPDF(item)){this.schedule(item);continue;}
        if(!PDFHelperMarkdown.isMD(item))continue;
      }else if(!this.attachmentParents.has(id))continue;
      const documentID=item?.parentID||this.attachmentParents.get(id);
      const parent=documentID&&Zotero.Items.get(documentID);
      const pdfIDs=parent&&!parent.deleted?parent.getAttachments():this.documents.get(documentID)||[];
      for(const pdfID of pdfIDs){const sibling=Zotero.Items.get(pdfID);if(PDFHelperMarkdown.isPDF(sibling))this.schedule(sibling);}
    }
  }
  schedule(pdf){
    if(!this.enabled||this.closed)return;
    const key=this.key(pdf);clearTimeout(this.timers.get(key));
    this.timers.set(key,setTimeout(()=>{
      this.timers.delete(key);
      this.sync(pdf).catch(()=>{
        Zotero.logError(new Error('Markdown 高亮同步未完成，请在设置的“高亮与复制”中重试。'));
        if(!this.failed.has(key)){this.failed.add(key);this.status.failed++;this.emit();}
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
    if(!this.enabled||this.closed||!PDFHelperMarkdown.isPDF(pdf)||!pdf.parentID)return;
    const generation=this.generation,key=this.key(pdf),siblings=await this.prepare(pdf);
    if(!this.enabled||this.closed||generation!==this.generation)return;
    const md=PDFHelperMarkdown.matchAttachment(pdf,siblings,this.bindings);if(!md)return;
    const library=Zotero.Libraries.get(pdf.libraryID);
    if(pdf.deleted||!pdf.isAttachment()||pdf.attachmentReaderType!=='pdf'||!md||!md.isAttachment()||md.deleted||
        !pdf.parentID||md.parentID!==pdf.parentID||!library.editable||!library.filesEditable||!md.isEditable())
      throw new Error('PDF / Markdown 关联或文库权限已变化');
    const path=await md.getFilePathAsync();
    if(!path||!await IOUtils.exists(path)||! /\.md$/i.test(path))return;
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
      if(this.closed||!this.enabled||generation!==this.generation)return;
      await IOUtils.writeUTF8(path,result.text,{tmpPath:path+'.pdf-helper.tmp'});
      this.dirty.add(md.libraryID+':'+md.key);
    }
    // Also retry this flag after a prior saveTx failure, even when bytes match.
    if(!md.isLinkedFileAttachment()&&(result.text!==original||this.dirty.has(md.libraryID+':'+md.key))){
      md.attachmentSyncState=Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD;
      await md.saveTx({skipSelect:true,notifierData:{pdfHelperMarkdown:true}});
    }
    this.dirty.delete(md.libraryID+':'+md.key);
    if(this.bindings[key]?.mdKey!==md.key){
      this.bindings[key]={libraryID:pdf.libraryID,pdfKey:pdf.key,mdKey:md.key};await this.persist();
    }
    this.failed.delete(key);return result;
  }
  async close(){
    this.closed=true;this.generation++;
    for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
    if(this.observer)Zotero.Notifier.unregisterObserver(this.observer);
    // Startup reconciliation catches changes that arrive during shutdown.
    await Promise.allSettled([...this.queues.values(),this.scanPromise,this.persistence]);this.listeners.clear();
  }
};
