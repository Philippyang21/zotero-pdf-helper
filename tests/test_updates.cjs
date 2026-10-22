'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const U=require('../plugin/content/updates.js');
const addonId='paddleocr-pdf-repair@local.tools';
// All URLs below are inert fixtures, never requested by these tests.
const config={schemaVersion:1,repositoryUrl:'https://github.com/test-owner/test-plugin',
 manifestUrl:'https://raw.githubusercontent.com/test-owner/test-plugin/main/release/update-manifest.json',
 communityUrl:'https://zotero-chinese.com/user-guide/plugins/test-plugin',
 allowedManifestHosts:['raw.githubusercontent.com'],allowedCommunityHosts:['zotero-chinese.com'],timeoutMs:10000,maxResponseBytes:65536};
const data={schemaVersion:1,published:true,addonId,latestVersion:'0.1.11',minZoteroVersion:'10.0',maxZoteroVersion:'10.0.*',releaseNotes:'测试说明\n第二行',communityUrl:config.communityUrl};
// Production injects Services.vc.compare. Fixture implements only the stable numeric/wildcard values in these tests.
function compareZotero(a,b){
 const parts=v=>v.split('.').map(x=>x==='*'?Infinity:Number(x));a=parts(a);b=parts(b);
 for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]??0,y=b[i]??0;if(x!==y)return x<y?-1:1;}return 0;
}
function fixture(overrides={}){
 const calls=[],opened=[],prompts=[];
 const deps={addonId,currentVersion:()=> '0.1.10',zoteroVersion:()=> '10.0.6',compareZotero,
  loadConfig:async()=>config,request:async(c,cancel)=>{calls.push(c);cancel(()=>{});return {...data};},
  confirm:async r=>{prompts.push(r);return true;},openURL:async url=>opened.push(url),...overrides};
 return {client:U.createClient(deps),calls,opened,prompts};
}
test('equal version is current and causes no external navigation',async()=>{
 const f=fixture({currentVersion:()=>data.latestVersion});assert.equal(f.calls.length,0);
 assert.equal((await f.client.check()).state,'current');assert.equal(f.calls.length,1);assert.equal(f.opened.length,0);
});
test('new stable version requires explicit confirmation and only opens community detail',async()=>{
 const f=fixture();const result=await f.client.check();assert.equal(result.state,'available');assert.equal(f.opened.length,0);
 assert.equal(result.releaseNotes,data.releaseNotes);assert.equal(await f.client.openCommunity(result),true);
 assert.deepEqual(f.opened,[config.communityUrl]);assert.equal(f.prompts.length,1);
});
test('cancel stays in settings and never launches browser',async()=>{
 const f=fixture({confirm:async()=>false});assert.equal(await f.client.openCommunity(await f.client.check()),false);assert.equal(f.opened.length,0);
});
for(const [a,b,expected] of [
 ['1.10.0','1.9.0',1],['1.9.0','1.10.0',-1],['0.1.10','0.1.9',1],['1.0.0','1.0.0',0],
 ['1.0.0','1.0.0-rc.1',1],['1.0.0-rc.2','1.0.0-rc.10',-1],['1.0.0-alpha','1.0.0-alpha.1',-1],
 ['1.0.0-1','1.0.0-alpha',-1],['1.0.0+build.2','1.0.0+build.1',0],
 ['999999999999999999999.0.0','999999999999999999998.0.0',1]
]) test('SemVer '+a+' vs '+b,()=>assert.equal(U.compareVersions(a,b),expected));
test('the full SemVer prerelease precedence sequence is ordered',()=>{
 const values=['alpha','alpha.1','alpha.beta','beta','beta.2','beta.11','rc.1'].map(v=>'1.0.0-'+v).concat('1.0.0');
 for(let i=1;i<values.length;i++)assert.equal(U.compareVersions(values[i-1],values[i]),-1);
});
for(const version of ['',undefined,'v1.0.0','1.0','1.01.0','1.0.0-01','1.0.0-','x.y.z','1.0.0\n'])
 test('invalid version fails: '+String(version),()=>assert.throws(()=>U.compareVersions(version,'1.0.0')));
test('stable channel rejects prerelease instead of recommending it',async()=>{
 const f=fixture({request:async()=>({...data,latestVersion:'2.0.0-beta.1'})});await assert.rejects(f.client.check(),{code:'prerelease'});
});
test('installed prerelease can upgrade to its final stable version',async()=>{
 const f=fixture({currentVersion:()=> '0.1.11-rc.1'});assert.equal((await f.client.check()).state,'available');
});
test('older stable does not downgrade an installed prerelease',async()=>{
 const f=fixture({currentVersion:()=> '0.1.12-rc.1'});assert.equal((await f.client.check()).state,'current');
});
for(const [name,patch] of [
 ['missing version',{latestVersion:undefined}],['invalid version',{latestVersion:'ten'}],
 ['missing min',{minZoteroVersion:undefined}],['missing max',{maxZoteroVersion:undefined}],
 ['bad range',{minZoteroVersion:'11.0',maxZoteroVersion:'10.0.*'}],['bad min',{minZoteroVersion:'10.x'}],
 ['bad max',{maxZoteroVersion:'10.*.0'}],['missing notes',{releaseNotes:undefined}],
 ['long notes',{releaseNotes:'x'.repeat(12001)}],['unpublished',{published:false}],
 ['wrong addon',{addonId:'someone-else'}],['wrong schema',{schemaVersion:2}],
 ['missing community',{communityUrl:undefined}],['homepage',{communityUrl:'https://zotero-chinese.com/plugins/'}],
 ['foreign domain',{communityUrl:'https://evil.test/user-guide/plugins/test-plugin'}],
 ['lookalike',{communityUrl:'https://zotero-chinese.com.evil.test/user-guide/plugins/test-plugin'}],
 ['different detail',{communityUrl:'https://zotero-chinese.com/user-guide/plugins/other'}],
 ['http community',{communityUrl:config.communityUrl.replace('https:','http:')}],
 ['credentials',{communityUrl:'https://user@zotero-chinese.com/user-guide/plugins/test-plugin'}],
 ['query redirect',{communityUrl:config.communityUrl+'?url=https://evil.test'}]
]) test('bad manifest: '+name,async()=>{
 const f=fixture({request:async()=>({...data,...patch})});await assert.rejects(f.client.check());assert.equal(f.opened.length,0);
});
test('null max explicitly permits later Zotero versions',async()=>{
 const f=fixture({zoteroVersion:()=> '11.0',request:async()=>({...data,maxZoteroVersion:null})});assert.equal((await f.client.check()).state,'available');
});
for(const version of ['9.0.6','10.1','11.0']) test('incompatible Zotero '+version+' is never recommended',async()=>{
 const f=fixture({zoteroVersion:()=>version});const result=await f.client.check();assert.equal(result.state,'incompatible');
 await assert.rejects(f.client.openCommunity(result));assert.equal(f.prompts.length,0);assert.equal(f.opened.length,0);
});
for(const field of ['repositoryUrl','manifestUrl','communityUrl'])test('unconfigured '+field+' sends no request',async()=>{
 const f=fixture({loadConfig:async()=>({...config,[field]:null})});await assert.rejects(f.client.check(),{code:'not-configured'});assert.equal(f.calls.length,0);
});
for(const patch of [
 {manifestUrl:config.manifestUrl.replace('https:','http:')},
 {manifestUrl:config.manifestUrl.replace('test-owner','other-owner')},
 {manifestUrl:config.manifestUrl+'?token=secret'},
 {manifestUrl:config.manifestUrl.replace('raw.githubusercontent.com','evil.test')},
 {communityUrl:'https://zotero-chinese.com/'},{communityUrl:'https://zotero-chinese.com/plugins/'},
 {allowedCommunityHosts:['evil.test']},{maxResponseBytes:1048576},{timeoutMs:0}
])test('unsafe local config fails before networking '+JSON.stringify(patch),async()=>{
 const f=fixture({loadConfig:async()=>({...config,...patch})});await assert.rejects(f.client.check());assert.equal(f.calls.length,0);
});
for(const field of ['currentVersion','zoteroVersion'])test('unknown '+field+' fails',async()=>{
 const f=fixture({[field]:()=>undefined});await assert.rejects(f.client.check());assert.equal(f.calls.length,0);
});
for(const cause of ['offline','timeout','HTTP 500'])test(cause+' never becomes current',async()=>{
 let count=0;const f=fixture({request:async()=>{count++;throw new Error(cause);}});
 await assert.rejects(f.client.check());assert.equal(count,1);assert.equal(f.opened.length,0);
});
test('repeated clicks share one request; explicit later retry is possible',async()=>{
 let complete,count=0;const f=fixture({request:()=>{count++;return new Promise(resolve=>complete=resolve);}});
 const one=f.client.check(),two=f.client.check();assert.equal(one,two);
 await new Promise(resolve=>setImmediate(resolve));complete(data);await one;assert.equal(count,1);
 const three=f.client.check();await new Promise(resolve=>setImmediate(resolve));complete(data);await three;assert.equal(count,2);
});
test('a failed subsequent check invalidates the previous download result',async()=>{
 let count=0;const f=fixture({request:async()=>{if(++count>1)throw new Error('offline');return data;}});
 const old=await f.client.check();await assert.rejects(f.client.check());await assert.rejects(f.client.openCommunity(old));assert.equal(f.opened.length,0);
});
test('a changed local detail URL cannot repurpose a successful result',async()=>{
 let c={...config};const f=fixture({loadConfig:async()=>c});const old=await f.client.check();
 c={...config,communityUrl:'https://zotero-chinese.com/user-guide/plugins/other'};
 await assert.rejects(f.client.openCommunity(old));assert.equal(f.opened.length,0);
});
test('shutdown cancels an in-flight request and prevents future checks',async()=>{
 let cancelled=0,started;const ready=new Promise(resolve=>started=resolve);
 const f=fixture({request:(c,receive)=>new Promise((resolve,reject)=>{receive(()=>{cancelled++;reject(new Error('cancelled'));});started();})});
 const pending=f.client.check();await ready;f.client.dispose();await assert.rejects(pending);assert.equal(cancelled,1);await assert.rejects(f.client.check());
});
function httpFixture({text=JSON.stringify(data),status=200,url=config.manifestUrl,header=null,progress=0}={}){
 let observed,aborted=false;
 const http={async request(method,urlArg,options){
  observed={method,url:urlArg,options};const handlers={};
  const xhr={readyState:2,abort(){aborted=true;},getResponseHeader:()=>header,addEventListener:(name,fn)=>handlers[name]=fn};
  options.requestObserver(xhr);handlers.readystatechange();handlers.progress({loaded:progress});
  options.cancellerReceiver(()=>{});
  return {status,responseURL:url,responseText:text};
 }};
 return {http,get observed(){return observed;},get aborted(){return aborted;}};
}
test('transport uses host HTTP with bounded anonymous HTTPS request, no retry or redirect',async()=>{
 const f=httpFixture();assert.deepEqual(await U.requestManifest(f.http,config,()=>{}),data);
 const {method,url,options:o}=f.observed;assert.equal(method,'GET');assert.equal(url,config.manifestUrl);
 assert.equal(o.timeout,10000);assert.equal(o.anon,true);assert.equal(o.followRedirects,false);assert.equal(o.errorDelayMax,0);
 assert.deepEqual(o.headers,{Accept:'application/json'});assert.equal(o.body,undefined);assert.equal(o.responseType,'text');
});
for(const fixtureData of [{text:'not JSON'},{text:'{}x'},{text:'x'.repeat(65537)},
 {text:'中'.repeat(22000)},{status:500},{status:302},{url:'https://evil.test/data.json'},
 {header:'65537'},{progress:65537}])test('transport rejects invalid response '+JSON.stringify({...fixtureData,text:fixtureData.text?.slice(0,12)}),async()=>{
 const f=httpFixture(fixtureData);await assert.rejects(U.requestManifest(f.http,config,()=>{}));
 if(fixtureData.header || fixtureData.progress)assert.equal(f.aborted,true);
});
test('runtime adapter loads only local config on click and uses installed version and native confirmation',async()=>{
 const calls=[],launched=[];const app={id:addonId,version:'0.1.10',rootURI:'jar:file:///fixture.xpi!/'};
 const transport=httpFixture();let answer=false;
 const host={Zotero:{version:'10.0.6',File:{getContentsFromURLAsync:async uri=>{calls.push(uri);return JSON.stringify(config);}},
  HTTP:transport.http,getMainWindow:()=>null,launchURL:url=>launched.push(url)},
  Services:{vc:{compare:compareZotero},prompt:{confirm:()=>answer}}};
 const client=U.forZotero(app,host);assert.equal(calls.length,0);const result=await client.check();assert.equal(calls[0],app.rootURI+'update-config.json');
 assert.equal(result.currentVersion,app.version);assert.equal(await client.openCommunity(result),false);assert.equal(launched.length,0);
 answer=true;assert.equal(await client.openCommunity(result),true);assert.deepEqual(launched,[config.communityUrl]);
});
test('bootstrap isolates a broken update module from original OCR initialization',async()=>{
 let initialized=0;const context=vm.createContext({
  Zotero:{logError:()=>{}},Services:{io:{newURI:()=>({})},scriptloader:{loadSubScript:uri=>{if(uri.endsWith('updates.js'))throw Error('broken');}}},
  Cc:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>({})})}},Ci:{},
  PDFRepair:class {async init(){initialized++;}}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../plugin/bootstrap.js'),'utf8'),context);
 await context.startup({id:addonId,version:'0.1.11',rootURI:'fixture:///'});assert.equal(initialized,1);assert.ok(context.Zotero.PaddleOCRRepair);
});
test('bootstrap subscript without DOM globals reuses host URL and UTF-8 constructors',async()=>{
 const hostWindow={URL,TextEncoder};
 const context=vm.createContext({Zotero:{getMainWindow:()=>hostWindow}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../plugin/content/updates.js'),'utf8'),context);
 assert.equal(context.POCRUpdates.validateConfig(config).manifestUrl,config.manifestUrl);
 const http=httpFixture();assert.equal((await context.POCRUpdates.requestManifest(http.http,config,()=>{})).latestVersion,data.latestVersion);
});
