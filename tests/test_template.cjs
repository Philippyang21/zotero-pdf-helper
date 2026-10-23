'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const built=path.join(root,'.scaffold/build/addon');
const meta=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function fixture({real=false,failInit=false,failModule='',ready,closing,initializing}={}){
  const calls={starts:0,closes:0,loads:[],unloads:[],errors:[],destructs:0,requests:0,prefs:[],timers:new Set(),readers:new Map(),observers:new Map()};
  const Zotero={version:'10.0.6',Profile:{dir:'fixture-profile'},initializationPromise:ready?.promise||Promise.resolve(),
    unlockPromise:Promise.resolve(),uiReadyPromise:Promise.resolve(),getMainWindows:()=>[],getMainWindow:()=>null,
    Prefs:{get:()=>undefined,set:()=>assert.fail('No preference write during migration startup')},
    PreferencePanes:{register:async options=>calls.prefs.push(options)},
    Reader:{registerEventListener:(type,fn)=>calls.readers.set(type,fn),unregisterEventListener:type=>calls.readers.delete(type),_readers:[]},
    Notifier:{registerObserver:observer=>{calls.observers.set(1,observer);return 1;},unregisterObserver:id=>calls.observers.delete(id)},
    HTTP:{request:()=>{calls.requests++;assert.fail('No startup HTTP request');}},logError:e=>calls.errors.push(String(e))};
  class FakeRepair {
    constructor(options){Object.assign(this,options);calls.repair=this;}
    async init(){calls.starts++;if(initializing)await initializing.promise;if(failInit)throw new Error('fixture initialization failure');}
    async shutdown(){calls.closes++;if(closing)await closing.promise;}
    addWindow(window){calls.loads.push(window);}
    removeWindow(window){calls.unloads.push(window);}
  }
  let pluginScope;
  const Services={io:{newURI:value=>value},scriptloader:{loadSubScript(uri,target){
    const name=uri.slice('fixture:///'.length);
    if(name===failModule)throw new Error('fixture module failure');
    if(!pluginScope){pluginScope=vm.createContext({...target});pluginScope._globalThis=pluginScope;}
    const ctx=pluginScope;
    if(!real&&name==='repair.js'){ctx.PDFRepair=FakeRepair;return;}
    vm.runInContext(fs.readFileSync(path.join(built,name),'utf8'),ctx,{filename:name});
    Object.assign(target,ctx);
  }}};
  const Cc={'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>({destruct:()=>calls.destructs++})})}};
  const context=vm.createContext({Zotero,Services,Cc,Ci:{},Components:{},ChromeUtils:{},
    IOUtils:{makeDirectory:async()=>{},exists:async()=>false},PathUtils:{join:(...parts)=>parts.join('/')},
    setInterval:fn=>{calls.timers.add(fn);return fn;},clearInterval:id=>calls.timers.delete(id),setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(built,'bootstrap.js'),'utf8'),context);
  const begin=()=>context.startup({id:meta.config.addonID,version:meta.version,rootURI:'fixture:///'});
  return {calls,Zotero,context,begin,start:async()=>{await begin();try{await context.pluginStartup;}finally{await context.pluginStartupCleanup;}},stop:()=>context.shutdown()};
}

test('template entry preserves legacy identity and dispatches windows through hooks',async()=>{
  const f=fixture();await f.start();
  assert.equal(f.Zotero.PDFHelperAddon.data.initialized,true);
  assert.equal(f.Zotero.PaddleOCRRepair,f.calls.repair);
  assert.equal(f.calls.repair.id,'paddleocr-pdf-repair@local.tools');
  assert.equal(f.calls.repair.version,meta.version);
  const window={};f.context.onMainWindowLoad({window});f.context.onMainWindowUnload({window});
  assert.deepEqual(f.calls.loads,[window]);assert.deepEqual(f.calls.unloads,[window]);
  await f.stop();assert.equal(f.calls.closes,1);assert.equal(f.calls.destructs,1);
  assert.equal(f.Zotero.PDFHelperAddon,undefined);assert.equal(f.Zotero.PaddleOCRRepair,undefined);
  assert.equal(f.Zotero._toolkitGlobal,undefined);
});

test('template waits for Zotero readiness before initializing the existing runtime',async()=>{
  const ready=deferred(),f=fixture({ready});const started=f.start();
  await Promise.resolve();assert.equal(f.calls.starts,0);
  ready.resolve();await started;assert.equal(f.calls.starts,1);await f.stop();
});

test('bootstrap returns before host readiness and a disabled waiting plugin never starts later',async()=>{
  const ready=deferred(),f=fixture({ready});
  await f.begin();
  assert.equal(f.calls.starts,0);
  await f.stop();
  assert.equal(f.calls.destructs,1);
  ready.resolve();await f.context.pluginStartup;
  assert.equal(f.calls.starts,0);assert.equal(f.calls.closes,0);
  assert.equal(f.Zotero.PDFHelperAddon,undefined);assert.equal(f.Zotero.PaddleOCRRepair,undefined);
});

test('shutdown waits for an initializing runtime and never marks the disabled plugin ready',async()=>{
  const initializing=deferred(),f=fixture({initializing});
  await f.begin();await new Promise(setImmediate);
  assert.equal(f.calls.starts,1);const instance=f.Zotero.PDFHelperAddon;
  const stopped=f.stop();await Promise.resolve();assert.equal(f.calls.closes,0);
  initializing.resolve();await stopped;await f.context.pluginStartup;
  assert.equal(f.calls.closes,1);assert.equal(instance.data.initialized,false);
  assert.equal(f.Zotero.PDFHelperAddon,undefined);assert.equal(f.Zotero.PaddleOCRRepair,undefined);
});

test('shutdown waits for pending cleanup before releasing chrome registration',async()=>{
  const closing=deferred(),f=fixture({closing});await f.start();const stopped=f.stop();
  await Promise.resolve();assert.equal(f.calls.destructs,0);
  closing.resolve();await stopped;assert.equal(f.calls.destructs,1);
  await f.stop();assert.equal(f.calls.closes,1);
});

test('failed initialization removes the partial runtime and chrome registration',async()=>{
  const f=fixture({failInit:true});await assert.rejects(f.start(),/initialization failure/);
  assert.equal(f.calls.closes,1);assert.equal(f.calls.destructs,1);
  assert.equal(f.Zotero.PDFHelperAddon,undefined);assert.equal(f.Zotero.PaddleOCRRepair,undefined);
});

test('optional text module failure still starts the PDF runtime and update module',async()=>{
  const f=fixture({failModule:'content/text/options.js'});await f.start();
  assert.equal(f.calls.starts,1);assert.ok(f.calls.repair.updates);assert.equal(f.calls.errors.length,1);await f.stop();
});

test('optional update module failure still starts the existing PDF runtime',async()=>{
  const f=fixture({failModule:'content/updates.js'});await f.start();
  assert.equal(f.calls.starts,1);assert.equal(f.calls.errors.length,1);await f.stop();
});

test('real modules initialize with preserved preferences and no helper or network activity',async()=>{
  const f=fixture({real:true});await f.start();
  const app=f.Zotero.PaddleOCRRepair;
  assert.equal(app.data,'fixture-profile/paddleocr-pdf-repair');
  assert.equal(app.credentialHost,'chrome://paddleocrrepair');assert.equal(app.credentialRealm,'PaddleOCR API');
  assert.equal(f.calls.prefs[0].id,'paddleocrrepair-preferences');
  assert.equal(f.calls.prefs[0].pluginID,'paddleocr-pdf-repair@local.tools');
  assert.equal(f.calls.requests,0);assert.equal(f.calls.timers.size,1);
  assert.equal(f.calls.readers.size,2);assert.equal(f.calls.observers.size,1);
  assert.equal(f.calls.errors.length,0);assert.equal(f.Zotero._toolkitGlobal,undefined);
  await f.stop();assert.equal(f.calls.timers.size,0);assert.equal(f.calls.readers.size,0);assert.equal(f.calls.observers.size,0);
});

test('an older runtime shutting down does not remove a replacement instance',async()=>{
  const f=fixture();await f.start();const replacement={};
  f.Zotero.PDFHelperAddon=replacement;f.Zotero.PaddleOCRRepair=replacement;
  await f.stop();assert.equal(f.Zotero.PDFHelperAddon,replacement);assert.equal(f.Zotero.PaddleOCRRepair,replacement);
});
