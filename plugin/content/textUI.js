/* global Zotero, Cc, Ci, AcademicText, AcademicTextAnnotations */
'use strict';
var AcademicTextUI = class {
  constructor(app){
    this.app=app;this.windows=new Map();this.listeners=[];this.dialog=null;
    this.annotations=new AcademicTextAnnotations({enabled:()=>this.getOptions().enabled,
      autoEnabled:()=>this.app.pref('text.cleanNewHighlights')!==false,
      process:text=>AcademicText.cleanAcademicText(text,this.getOptions()),onError:()=>this.logError()});
  }
  logError(){try{Zotero.logError(new Error('引用文本整理遇到问题，已保留原文。'));}catch(_) {}}
  getOptions(){
    try{
      const stored=this.app.pref('text.options');
      const options=stored ? JSON.parse(stored) : {};
      if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('invalid settings');
      return AcademicText.resolve({...options,enabled:this.app.pref('text.enabled')!==false});
    }catch(_){this.logError();return AcademicText.resolve({enabled:false});}
  }
  preset(name){return AcademicText.preset(name);}
  saveOptions(options,cleanNewHighlights){
    const normalized=AcademicText.resolve(options);
    this.app.setPref('text.options',JSON.stringify(normalized));
    this.app.setPref('text.enabled',normalized.enabled);
    this.app.setPref('text.cleanNewHighlights',!!cleanNewHighlights);
    this.dialog?.refreshText?.();
  }
  process(text,options){
    try{return AcademicText.cleanAcademicText(text,options??this.getOptions());}
    catch(_){this.logError();return text;}
  }
  copy(text,rawOnly=false,options){
    if(typeof text!=='string'||!text.trim())throw new Error('没有可复制的文字，请先选中文字或高亮。');
    const output=rawOnly ? text : this.process(text,options);
    Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(output);
    return output;
  }
  annotationText(reader,ids){
    const attachment=Zotero.Items.get(reader.itemID);
    if(!attachment)return '';
    const texts=[];
    for(const id of ids||[]){
      const item=typeof id==='number' ? Zotero.Items.get(id) : Zotero.Items.getByLibraryAndKey(attachment.libraryID,id);
      if(item?.isAnnotation()&&item.parentID===reader.itemID){
        const text=item.annotationText||item.annotationComment||'';
        if(text.trim())texts.push(text);
      }
    }
    return texts.join('\n\n');
  }
  async saveSelected(reader,ids){
    const options=this.getOptions();
    if(!options.enabled){this.app.alert('请先在“阅读与引用 → 高亮与复制”中开启引用文本整理，并保存设置。');return;}
    const selected=this.annotations.selected(reader,ids);
    if(!selected.length){this.app.alert('没有可处理的高亮。请选择当前 PDF 中可编辑的高亮或下划线。');return;}
    if(!this.app.confirm(`将按当前已保存的规则整理选中的 ${selected.length} 条高亮/下划线，并保存到 Zotero 注释。\n\n只处理选中项，不修改 PDF、评论或其他高亮；不保留修改前的副本。是否继续？`))return;
    const result=await this.annotations.cleanSelected(reader,selected.map(item=>item.id),text=>AcademicText.cleanAcademicText(text,options));
    this.app.notify(`高亮整理：已保存 ${result.saved} 条，无需修改 ${result.unchanged} 条，已跳过 ${result.skipped} 条，保存失败 ${result.failed} 条。`);
    return result;
  }
  init(){
    // All PDFs are supported; this does not consult OCR jobs, receipts or MD/JSON.
    this.annotations.init();
    if(!Zotero.Reader?.registerEventListener)return;
    const register=(type,fn)=>{
      const handler=event=>{try{fn(event);}catch(_){this.logError();}};
      Zotero.Reader.registerEventListener(type,handler,this.app.id);this.listeners.push([type,handler]);
    };
    register('renderTextSelectionPopup',({doc,params,append})=>{
      const raw=params?.annotation?.text;if(typeof raw!=='string'||!raw.trim())return;
      const box=doc.createElement('div');box.style.cssText='display:flex;gap:6px;flex-wrap:wrap;padding:4px';
      for(const [label,rawOnly] of [['复制为论文引用文本',false],['复制原始文字',true]]){
        const button=doc.createElement('button');button.textContent=label;button.type='button';
        button.addEventListener('click',event=>{
          event.stopPropagation();
          try{this.copy(raw,rawOnly);button.textContent='已复制';}catch(e){button.textContent=e.message;}
        });box.append(button);
      }
      append(box);
    });
    register('createAnnotationContextMenu',({reader,params,append})=>{
      const ids=[...(params?.ids||[])],raw=this.annotationText(reader,ids);if(!raw)return;
      for(const [label,rawOnly] of [['复制为论文引用文本',false],['复制当前注释文字',true]])append({label,onCommand:()=>{
        try{this.copy(raw,rawOnly);}catch(e){this.app.alert(e.message);}
      }});
      if(this.annotations.selected(reader,ids).length)append({label:'整理并保存选中高亮文字…',
        disabled:!this.getOptions().enabled,onCommand:()=>this.saveSelected(reader,ids).catch(()=>{
          this.logError();this.app.alert('高亮整理未完成。请检查文库是否可写，再重新选择高亮重试。');
        })});
    });
  }
  addWindow(win){
    if(this.windows.has(win))return;
    const menu=win.document.getElementById('menu_ToolsPopup');if(!menu)return;
    const item=win.document.createXULElement('menuitem');item.setAttribute('label','引用文本整理：粘贴并复制');
    item.addEventListener('command',()=>this.open(win));menu.append(item);this.windows.set(win,item);
  }
  removeWindow(win){this.windows.get(win)?.remove();this.windows.delete(win);}
  open(win=Zotero.getMainWindow()){
    if(this.dialog&&!this.dialog.closed){this.dialog.focus();return;}
    this.dialog=win.openDialog('chrome://paddleocrrepair/content/textDialog.xhtml','paddleocr-text',
      'chrome,centerscreen,resizable,width=800,height=700',{tools:this});
  }
  async shutdown(){
    for(const [type,handler] of this.listeners)Zotero.Reader.unregisterEventListener(type,handler);
    this.listeners=[];
    for(const win of [...this.windows.keys()])this.removeWindow(win);
    if(this.dialog&&!this.dialog.closed)this.dialog.close();this.dialog=null;
    await this.annotations.close();
  }
};
