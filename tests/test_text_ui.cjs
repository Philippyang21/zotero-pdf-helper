'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');const {test}=require('node:test');
const root=path.resolve(__dirname,'..');
function fixture(){
 const prefs=new Map([['text.enabled',true],['text.cleanNewHighlights',true],['text.options','{"preset":"paper"}']]);
 const writes=[],errors=[],events=new Map(),copied=[];
 const annotation=Object.freeze({id:20,key:'ABCDEFGH',libraryID:1,parentID:10,annotationType:'highlight',annotationText:'中国 文学, "史料"如此.',annotationComment:'独立评论',isAnnotation:()=>true,isEditable:()=>true});
 const comment=Object.freeze({id:21,key:'COMMENT1',libraryID:1,parentID:10,annotationType:'note',annotationText:'',annotationComment:'批注 内容。',isAnnotation:()=>true,isEditable:()=>true});
 const foreign=Object.freeze({...annotation,id:30,key:'FOREIGN1',parentID:11});
 const Zotero={Notifier:{registerObserver:()=>1,unregisterObserver:()=>{}},Reader:{_readers:[],registerEventListener:(type,fn,id)=>events.set(type,{fn,id}),unregisterEventListener:type=>events.delete(type)},
  Items:{get:id=>id===10?{id:10,libraryID:1,isAttachment:()=>true,attachmentReaderType:'pdf'}:id===20?annotation:id===21?comment:foreign,
   getByLibraryAndKey:(library,key)=>library===1?({ABCDEFGH:annotation,COMMENT1:comment,FOREIGN1:foreign})[key]:null},logError:e=>errors.push(e)};
 const fail=()=>{throw new Error('OCR/network/database must not be used');};
 const app={id:'plugin@fixture',pref:key=>prefs.get(key),setPref:(key,value)=>{prefs.set(key,value);writes.push(key);},ensure:fail,configure:fail,request:fail,alert:fail,notify:()=>{}};
 const ctx=vm.createContext({Zotero,Cc:{'@mozilla.org/widget/clipboardhelper;1':{getService:()=>({copyString:text=>copied.push(text)})}},Ci:{nsIClipboardHelper:{}}});
 for(const name of ['options','protected','lineBreaks','whitespace','punctuation','index','annotations'])vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/text',name+'.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'plugin/content/textUI.js'),'utf8'),ctx);
 ctx.app=app;const tools=vm.runInContext('new AcademicTextUI(app)',ctx);
 return {tools,prefs,writes,errors,events,copied,ctx,annotation,Zotero};
}
test('text outlets run with OCR, network, process and database entirely unavailable',()=>{
 const f=fixture();f.tools.init();
 assert.equal(f.events.size,2);f.tools.copy(f.annotation.annotationText);
 assert.equal(f.copied[0],'中国文学，“史料”如此。');assert.equal(f.writes.length,0);
 assert.equal(f.annotation.annotationText,'中国 文学, "史料"如此.');
 f.tools.copy(f.annotation.annotationText,true);assert.equal(f.copied[1],f.annotation.annotationText);
 f.tools.shutdown();assert.equal(f.events.size,0);
});
test('annotation context menu resolves library keys and does not overwrite annotationText',()=>{
 const f=fixture();f.tools.init();const items=[];
 f.events.get('createAnnotationContextMenu').fn({reader:{itemID:10},params:{ids:['ABCDEFGH','FOREIGN1']},append:v=>items.push(v)});
 assert.equal(items.length,3);items[0].onCommand();items[1].onCommand();
 assert.equal(items[2].label,'整理并保存选中高亮文字…');assert.equal(items[2].disabled,false);
 assert.equal(f.copied[0],'中国文学，“史料”如此。');assert.equal(f.copied[1],f.annotation.annotationText);
 assert.equal(f.tools.annotationText({itemID:10},['COMMENT1']),'批注 内容。');
 assert.equal(f.tools.annotationText({itemID:10},['ABCDEFGH','COMMENT1']),f.annotation.annotationText+'\n\n批注 内容。');
 assert.equal(f.writes.length,0);
});
test('manual save menu is unavailable with master off and absent for comment-only selections',()=>{
 const f=fixture();f.tools.init();f.prefs.set('text.enabled',false);const menu=[];
 f.events.get('createAnnotationContextMenu').fn({reader:{itemID:10},params:{ids:['ABCDEFGH']},append:v=>menu.push(v)});
 assert.equal(menu.at(-1).disabled,true);const comments=[];
 f.events.get('createAnnotationContextMenu').fn({reader:{itemID:10},params:{ids:['COMMENT1']},append:v=>comments.push(v)});
 assert.equal(comments.length,2);assert.equal(f.writes.length,0);
});
test('selection popup uses original selection data and local copy actions',()=>{
 const f=fixture();f.tools.init();const appended=[];
 function element(){return {style:{},children:[],events:{},append(child){this.children.push(child);},addEventListener(type,fn){this.events[type]=fn;}};}
 const params=Object.freeze({annotation:Object.freeze({text:'中国 文学\n史料 学。'})});
 f.events.get('renderTextSelectionPopup').fn({doc:{createElement:element},params,append:node=>appended.push(node)});
 assert.equal(appended.length,1);const buttons=appended[0].children;
 buttons[0].events.click({stopPropagation(){}});assert.equal(f.copied[0],'中国文学史料学。');
 buttons[1].events.click({stopPropagation(){}});assert.equal(f.copied[1],params.annotation.text);
});
test('processing exception returns original text and does not log the excerpt',()=>{
 const f=fixture(),raw='敏感原文不可写入日志';
 vm.runInContext('AcademicText.cleanAcademicText=()=>{throw new Error("fixture")}',f.ctx);
 assert.equal(f.tools.process(raw),raw);f.tools.copy(raw);assert.equal(f.copied[0],raw);
 assert.equal(f.errors.length,2);assert.ok(f.errors.every(e=>!String(e).includes(raw)));
});
test('saved configuration and master switch work without helper configuration',()=>{
 const f=fixture();f.tools.saveOptions({preset:'custom',punctuation:'english',enabled:true},false);
 assert.equal(f.tools.getOptions().preset,'custom');assert.equal(f.tools.getOptions().punctuation,'english');
 assert.equal(f.prefs.get('text.cleanNewHighlights'),false);
 assert.deepEqual(f.writes,['text.options','text.enabled','text.cleanNewHighlights']);
 f.tools.copy('中国文学，研究。');assert.equal(f.copied[0],'中国文学, 研究.');
 f.tools.saveOptions({...f.tools.getOptions(),enabled:false},true);
 f.tools.copy(f.annotation.annotationText);assert.equal(f.copied[1],f.annotation.annotationText);
});
test('malformed saved settings fail closed to the original text',()=>{
 const f=fixture();f.prefs.set('text.options','{bad');
 assert.equal(f.tools.process(f.annotation.annotationText),f.annotation.annotationText);assert.ok(f.errors.length);
});
test('reader callback errors do not escape into annotation creation',()=>{
 const f=fixture();f.tools.init();
 assert.doesNotThrow(()=>f.events.get('renderTextSelectionPopup').fn({doc:null,params:{annotation:{text:'原文'}},append(){}}));
 assert.ok(f.errors.length);assert.equal(f.annotation.annotationText,'中国 文学, "史料"如此.');
});
