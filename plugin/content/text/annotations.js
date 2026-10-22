/* global Zotero */
'use strict';
// Persist annotation text via Zotero's item API. Never overlays or rewrites reader DOM.
var AcademicTextAnnotations = class {
  constructor({enabled,autoEnabled=enabled,process,onError}){
    this.enabled=enabled;this.autoEnabled=autoEnabled;this.process=process;this.onError=onError;
    this.observerID=null;this.closed=false;this.pending=new Set();this.saving=new Set();
  }
  init(){
    if(!Zotero.Notifier?.registerObserver)return;
    this.closed=false;
    this.observerID=Zotero.Notifier.registerObserver({notify:(...args)=>this.notify(...args)},
      ['item'],'paddleocr-text-annotations');
  }
  editable(item,attachmentID){
    if(!item?.isAnnotation()||item.deleted||item.parentID!==attachmentID||item.annotationIsExternal)return false;
    if(!['highlight','underline'].includes(item.annotationType)||!item.isEditable())return false;
    const attachment=Zotero.Items.get(attachmentID);
    return !!attachment?.isAttachment()&&attachment.attachmentReaderType==='pdf';
  }
  selected(reader,ids){
    const attachment=Zotero.Items.get(reader?.itemID),items=[],seen=new Set();
    if(!attachment?.isAttachment()||attachment.attachmentReaderType!=='pdf')return items;
    for(const id of ids||[]){
      const item=typeof id==='number' ? Zotero.Items.get(id) : Zotero.Items.getByLibraryAndKey(attachment.libraryID,id);
      if(item?.libraryID===attachment.libraryID&&this.editable(item,attachment.id)&&!seen.has(item.id)){
        seen.add(item.id);items.push(item);
      }
    }
    return items;
  }
  track(job){
    this.pending.add(job);
    job.then(()=>this.pending.delete(job),()=>this.pending.delete(job));
    return job;
  }
  cleanSelected(reader,ids,process=this.process){
    // Snapshot only explicitly selected excerpts. Never enumerate the PDF or library.
    const selected=this.selected(reader,ids).map(item=>({item,expected:item.annotationText}));
    const run=async()=>{
      const result={saved:0,unchanged:0,skipped:0,failed:0};
      for(const {item,expected} of selected){
        try{result[await this.clean(item,reader.itemID,expected,process)]++;}
        catch(_){result.failed++;this.onError();}
      }
      return result;
    };
    return this.track(run());
  }
  async clean(item,attachmentID,expectedText,process=this.process){
    if(this.closed||!this.enabled()||!this.editable(item,attachmentID)||this.saving.has(item.id))return 'skipped';
    const original=item.annotationText;
    // A user edit/deletion that overtook the new-item notification wins over automatic cleanup.
    if(typeof original!=='string'||!original.trim()||(expectedText!==undefined&&original!==expectedText))return 'skipped';
    const cleaned=process(original);
    if(typeof cleaned!=='string'||!cleaned.trim()||cleaned===original)return 'unchanged';
    this.saving.add(item.id);
    try{
      item.annotationText=cleaned;
      // Do NOT forward the originating instanceID: native Reader must receive this modification.
      await item.saveTx({skipSelect:true,notifierData:{paddleocrTextCleaned:true}});
      return 'saved';
    }catch(e){
      // The database save failed. Don't leave a dirty cleaned value in the shared item cache,
      // and don't overwrite a newer user edit that may have happened while saveTx awaited.
      if(item.annotationText===cleaned)item.annotationText=original;
      throw e;
    }finally{this.saving.delete(item.id);}
  }
  async notify(event,type,ids,extraData){
    if(this.closed||event!=='add'||type!=='item')return;
    try{
      if(!this.enabled()||!this.autoEnabled())return;
      const jobs=[];
      for(const id of ids||[]){
        try{
          const instanceID=extraData?.[id]?.instanceID;
          // Only a newly created annotation from a live PDF Reader. Not sync/import or old items.
          if(!instanceID)continue;
          const item=Zotero.Items.get(id);
          const reader=(Zotero.Reader?._readers||[]).find(r=>r._instanceID===instanceID&&r.itemID===item?.parentID);
          if(!reader||!this.editable(item,reader.itemID))continue;
          const expected=item.annotationText;
          const job=this.clean(item,reader.itemID,expected).catch(()=>{this.onError();return 'failed';});
          jobs.push(this.track(job));
        }catch(_){this.onError();}
      }
      await Promise.all(jobs);
    }catch(_){this.onError();}
  }
  async close(){
    this.closed=true;
    if(this.observerID!==null)Zotero.Notifier.unregisterObserver(this.observerID);
    this.observerID=null;
    await Promise.all([...this.pending]);
  }
};
