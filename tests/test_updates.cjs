'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const U=require('../plugin/content/updates.js');
const addonId='paddleocr-pdf-repair@local.tools';
// All URLs below are inert fixtures, never requested by these tests.
const config={schemaVersion:4,repositoryUrl:'https://github.com/test-owner/test-plugin',
 latestReleaseUrl:'https://github.com/test-owner/test-plugin/releases/latest',assetNamePrefix:'pdf-helper',
 timeoutMs:10000,maxResponseBytes:65536};
const data={schemaVersion:2,published:true,addonId,latestVersion:'0.1.11',minZoteroVersion:'10.0',maxZoteroVersion:'10.0.*',releaseNotes:'测试说明\n第二行',releaseUrl:config.repositoryUrl+'/releases/tag/v0.1.11'};
const metadata={manifest_version:2,version:'0.1.11',applications:{zotero:{id:addonId,strict_min_version:'10.0',strict_max_version:'10.0.*'}}};
const metadataUrl='https://raw.githubusercontent.com/test-owner/test-plugin/v0.1.11/plugin/manifest.json';
const assetUrl=config.repositoryUrl+'/releases/download/v0.1.11/pdf-helper-0.1.11.xpi';
function githubHTTP(patch={},metadataPatch={}){
 const calls=[];
 return {calls,async request(method,url,options){
  calls.push({method,url,options});options.cancellerReceiver(()=>{});
  assert.ok(!url.includes('api.github.com'),'REST API must never be queried');
  if(url===config.latestReleaseUrl){
   assert.equal(method,'HEAD');if([403,429].includes(patch.status))throw {status:patch.status};
   return {status:patch.status??302,responseURL:patch.responseURL,getResponseHeader:()=>('location' in patch?patch.location:data.releaseUrl)};
  }
  if(url===assetUrl){assert.equal(method,'HEAD');if(patch.assetStatus===404)throw {status:404};return {status:patch.assetStatus??302};}
  assert.equal(url,metadataUrl);assert.equal(method,'GET');
  return {status:200,responseURL:url,responseText:JSON.stringify({...metadata,...metadataPatch})};
 }};
}
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
test('new stable version requires explicit confirmation and only opens its GitHub release',async()=>{
 const f=fixture();const result=await f.client.check();assert.equal(result.state,'available');assert.equal(f.opened.length,0);
 assert.equal(result.releaseNotes,data.releaseNotes);assert.equal(await f.client.openRelease(result),true);
 assert.deepEqual(f.opened,[data.releaseUrl]);assert.equal(f.prompts.length,1);
});
test('cancel stays in settings and never launches browser',async()=>{
 const f=fixture({confirm:async()=>false});assert.equal(await f.client.openRelease(await f.client.check()),false);assert.equal(f.opened.length,0);
});

test('later releases use the advertised version page without changing client config',async()=>{
 const releaseUrl=config.repositoryUrl+'/releases/tag/v1.10.0';
 const f=fixture({request:async()=>({...data,latestVersion:'1.10.0',releaseUrl})});
 assert.equal(await f.client.openRelease(await f.client.check()),true);assert.deepEqual(f.opened,[releaseUrl]);
 assert.equal('communityUrl' in config,false);
});

test('candidate validation does not enable an unpublished runtime feed',async()=>{
 const candidate={...data,published:false};
 assert.equal(U.validateManifest(candidate,config,addonId,compareZotero,{allowUnpublished:true}).releaseUrl,data.releaseUrl);
 const f=fixture({request:async()=>candidate});await assert.rejects(f.client.check(),{code:'manifest'});
});

test('a new check while confirmation is open invalidates the old navigation',async()=>{
 let finish;const f=fixture({confirm:()=>new Promise(resolve=>finish=resolve)});
 const old=await f.client.check(),opening=f.client.openRelease(old);
 await new Promise(resolve=>setImmediate(resolve));await f.client.check();finish(true);
 await assert.rejects(opening,{code:'stale-result'});assert.equal(f.opened.length,0);
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
 const f=fixture({currentVersion:()=> '0.1.12-rc.1'});const result=await f.client.check();assert.equal(result.state,'current');assert.equal(result.isAhead,true);
});
for(const [name,patch] of [
 ['missing version',{latestVersion:undefined}],['invalid version',{latestVersion:'ten'}],
 ['missing min',{minZoteroVersion:undefined}],['missing max',{maxZoteroVersion:undefined}],
 ['bad range',{minZoteroVersion:'11.0',maxZoteroVersion:'10.0.*'}],['bad min',{minZoteroVersion:'10.x'}],
 ['bad max',{maxZoteroVersion:'10.*.0'}],['missing notes',{releaseNotes:undefined}],
 ['long notes',{releaseNotes:'x'.repeat(12001)}],['unpublished',{published:false}],
 ['wrong addon',{addonId:'someone-else'}],['old schema',{schemaVersion:1}],
 ['missing release',{releaseUrl:undefined}],['repository homepage',{releaseUrl:config.repositoryUrl}],
 ['release list',{releaseUrl:config.repositoryUrl+'/releases'}],['moving latest',{releaseUrl:config.repositoryUrl+'/releases/latest'}],
 ['foreign domain',{releaseUrl:'https://evil.test/test-owner/test-plugin/releases/tag/v0.1.11'}],
 ['lookalike',{releaseUrl:'https://github.com.evil.test/test-owner/test-plugin/releases/tag/v0.1.11'}],
 ['different owner',{releaseUrl:data.releaseUrl.replace('test-owner','other-owner')}],
 ['different repository',{releaseUrl:data.releaseUrl.replace('test-plugin','other-plugin')}],
 ['different version',{releaseUrl:data.releaseUrl.replace('v0.1.11','v0.1.12')}],
 ['direct XPI',{releaseUrl:config.repositoryUrl+'/releases/download/v0.1.11/test.xpi'}],
 ['community page',{releaseUrl:'https://zotero-chinese.com/user-guide/plugins/test-plugin'}],
 ['http release',{releaseUrl:data.releaseUrl.replace('https:','http:')}],
 ['credentials',{releaseUrl:data.releaseUrl.replace('https://','https://user@')}],
 ['query redirect',{releaseUrl:data.releaseUrl+'?url=https://evil.test'}],
 ['fragment',{releaseUrl:data.releaseUrl+'#assets'}],['port',{releaseUrl:data.releaseUrl.replace('github.com','github.com:443')}],
 ['encoded tag',{releaseUrl:data.releaseUrl.replace('v0.1.11','%760.1.11')}],
 ['normalized traversal',{releaseUrl:data.releaseUrl.replace('/tag/','/other/../tag/')}]
]) test('bad manifest: '+name,async()=>{
 const f=fixture({request:async()=>({...data,...patch})});await assert.rejects(f.client.check());assert.equal(f.opened.length,0);
});
test('null max explicitly permits later Zotero versions',async()=>{
 const f=fixture({zoteroVersion:()=> '11.0',request:async()=>({...data,maxZoteroVersion:null})});assert.equal((await f.client.check()).state,'available');
});
for(const version of ['9.0.6','10.1','11.0']) test('incompatible Zotero '+version+' is never recommended',async()=>{
 const f=fixture({zoteroVersion:()=>version});const result=await f.client.check();assert.equal(result.state,'incompatible');
 await assert.rejects(f.client.openRelease(result));assert.equal(f.prompts.length,0);assert.equal(f.opened.length,0);
});
for(const field of ['repositoryUrl','latestReleaseUrl'])test('unconfigured '+field+' sends no request',async()=>{
 const f=fixture({loadConfig:async()=>({...config,[field]:null})});await assert.rejects(f.client.check(),{code:'not-configured'});assert.equal(f.calls.length,0);
});
for(const patch of [
 {latestReleaseUrl:config.latestReleaseUrl.replace('https:','http:')},
 {latestReleaseUrl:config.latestReleaseUrl.replace('test-owner','other-owner')},
 {latestReleaseUrl:config.latestReleaseUrl+'?token=secret'},
 {latestReleaseUrl:config.latestReleaseUrl.replace('github.com','evil.test')},
 {repositoryUrl:'https://zotero-chinese.com/plugins/test-plugin'},
 {schemaVersion:1},{latestReleaseUrl:'https://api.github.com/repos/test-owner/test-plugin/releases'},{maxResponseBytes:1048576},{timeoutMs:0}
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
 const old=await f.client.check();await assert.rejects(f.client.check());await assert.rejects(f.client.openRelease(old));assert.equal(f.opened.length,0);
});
test('a changed local repository cannot repurpose a successful result',async()=>{
 let c={...config};const f=fixture({loadConfig:async()=>c});const old=await f.client.check();
 c={...config,repositoryUrl:config.repositoryUrl.replace('test-plugin','other-plugin'),latestReleaseUrl:config.latestReleaseUrl.replace('test-plugin','other-plugin')};
 await assert.rejects(f.client.openRelease(old));assert.equal(f.opened.length,0);
});
test('shutdown cancels an in-flight request and prevents future checks',async()=>{
 let cancelled=0,started;const ready=new Promise(resolve=>started=resolve);
 const f=fixture({request:(c,receive)=>new Promise((resolve,reject)=>{receive(()=>{cancelled++;reject(new Error('cancelled'));});started();})});
 const pending=f.client.check();await ready;f.client.dispose();await assert.rejects(pending);assert.equal(cancelled,1);await assert.rejects(f.client.check());
});
function httpFixture({text=JSON.stringify(data),status=200,url=metadataUrl,header=null,progress=0}={}){
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
 const f=httpFixture();assert.deepEqual(await U.requestJSON(f.http,config,()=>{},metadataUrl),data);
 const {method,url,options:o}=f.observed;assert.equal(method,'GET');assert.equal(url,metadataUrl);
 assert.equal(o.timeout,10000);assert.equal(o.anon,true);assert.equal(o.followRedirects,false);assert.equal(o.errorDelayMax,0);
 assert.deepEqual(o.headers,{Accept:'application/json'});assert.equal(o.body,undefined);assert.equal(o.responseType,'text');
});
for(const fixtureData of [{text:'not JSON'},{text:'{}x'},{text:'x'.repeat(65537)},
 {text:'中'.repeat(22000)},{status:500},{status:302},{url:'https://evil.test/data.json'},
 {header:'65537'},{progress:65537}])test('transport rejects invalid response '+JSON.stringify({...fixtureData,text:fixtureData.text?.slice(0,12)}),async()=>{
 const f=httpFixture(fixtureData);await assert.rejects(U.requestJSON(f.http,config,()=>{},metadataUrl));
 if(fixtureData.header || fixtureData.progress)assert.equal(f.aborted,true);
});
test('runtime adapter reads packaged jar config locally and uses installed version and native confirmation',async()=>{
 const calls=[],launched=[];const app={id:addonId,version:'0.1.10',rootURI:'jar:file:///fixture.xpi!/'};
 const transport=githubHTTP();let answer=false;
 const host={Zotero:{version:'10.0.6',File:{getContentsFromURL:uri=>{assert.ok(uri.startsWith('jar:'));calls.push(uri);return JSON.stringify(config);},
  getContentsFromURLAsync:()=>{throw Error('HTTP parser must never read jar config');}},
  HTTP:transport,getMainWindow:()=>null,launchURL:url=>launched.push(url)},
  Services:{vc:{compare:compareZotero},prompt:{confirm:()=>answer}}};
 const client=U.forZotero(app,host);assert.equal(calls.length,0);const result=await client.check();assert.equal(calls[0],app.rootURI+'update-config.json');
 assert.equal(result.currentVersion,app.version);assert.equal(await client.openRelease(result),false);assert.equal(launched.length,0);
 answer=true;assert.equal(await client.openRelease(result),true);assert.deepEqual(launched,[data.releaseUrl]);
 assert.deepEqual(transport.calls.map(call=>call.url),[config.latestReleaseUrl,metadataUrl,assetUrl]);
});

test('latest redirect, pinned metadata and HEAD asset check yield a valid update without REST API',async()=>{
 const http=githubHTTP(),result=await U.requestManifest(http,config,()=>{});
 assert.deepEqual({...result,releaseNotes:data.releaseNotes},data);
 assert.deepEqual(http.calls.map(call=>[call.method,call.url]),[['HEAD',config.latestReleaseUrl],['GET',metadataUrl],['HEAD',assetUrl]]);
 assert.ok(http.calls.every(call=>call.options.anon&&call.options.followRedirects===false));
 assert.match(result.releaseNotes,/GitHub/);
});
for(const [name,patch] of [
 ['no redirect',{status:200}],['missing location',{location:undefined}],['prerelease tag',{location:data.releaseUrl+'-rc.1'}],
 ['other owner',{location:data.releaseUrl.replace('test-owner','other-owner')}],
 ['other repository',{location:data.releaseUrl.replace('test-plugin','other-plugin')}],
 ['moving latest',{location:config.latestReleaseUrl}],['foreign domain',{location:'https://evil.test/releases/tag/v0.1.11'}],
 ['plain HTTP',{location:data.releaseUrl.replace('https:','http:')}],['tag traversal',{location:data.releaseUrl+'/../v0.1.12'}],
 ['query',{location:data.releaseUrl+'?token=secret'}],['fragment',{location:data.releaseUrl+'#assets'}],
 ['credentials',{location:data.releaseUrl.replace('https://','https://user@')}],['already followed',{responseURL:data.releaseUrl}]
])test('latest HEAD rejects '+name+' before fetching metadata',async()=>{
 const http=githubHTTP(patch);await assert.rejects(U.requestManifest(http,config,()=>{}));assert.equal(http.calls.length,1);
});
for(const status of [403,429])test('access restriction '+status+' is reported explicitly',async()=>{
 await assert.rejects(U.requestManifest(githubHTTP({status}),config,()=>{}),{code:'rate-limit'});
});
test('missing XPI is never recommended and HEAD never downloads the asset',async()=>{
 const http=githubHTTP({assetStatus:404});await assert.rejects(U.requestManifest(http,config,()=>{}),{code:'release-missing'});
 assert.equal(http.calls.at(-1).method,'HEAD');
});
test('un-followed HEAD response can omit responseURL as real Zotero does',async()=>{
 const result=await U.requestManifest(githubHTTP(),config,()=>{});assert.equal(result.latestVersion,'0.1.11');
});
for(const patch of [{version:'0.1.12'},{manifest_version:undefined},{applications:null}])
 test('tag manifest identity and version are validated '+JSON.stringify(patch),async()=>{
  await assert.rejects(U.requestManifest(githubHTTP({},patch),config,()=>{}),{code:'release-metadata'});
 });

test('wrong addon identity or missing compatibility in tag metadata never recommends an update',async()=>{
 for(const zotero of [{...metadata.applications.zotero,id:'wrong-addon'},{id:addonId}]){
  const normalized=await U.requestManifest(githubHTTP({},{applications:{zotero}}),config,()=>{});
  const f=fixture({request:async()=>normalized});await assert.rejects(f.client.check());assert.equal(f.opened.length,0);
 }
});

test('cancellation at request handoff prevents fetching tag metadata',async()=>{
 let cancel;const http=githubHTTP();const original=http.request;
 http.request=async(...args)=>{const result=await original(...args);cancel();return result;};
 await assert.rejects(U.requestManifest(http,config,fn=>cancel=fn),{code:'closed'});assert.equal(http.calls.length,1);
});

test('disposal cancels the second GitHub request',async()=>{
 let cancel,aborted=false;const http=githubHTTP(),original=http.request;
 http.request=async(method,url,options)=>{
  if(url===config.latestReleaseUrl)return original(method,url,options);
  return new Promise((resolve,reject)=>{options.cancellerReceiver(()=>{aborted=true;reject(new Error('cancelled'));});cancel();});
 };
 await assert.rejects(U.requestManifest(http,config,fn=>cancel=fn));assert.equal(aborted,true);
});
test('template runtime isolates a broken update module from original OCR initialization',async()=>{
 let initialized=0;const context=vm.createContext({rootURI:'fixture:///',
  Zotero:{logError:()=>{},initializationPromise:Promise.resolve(),unlockPromise:Promise.resolve(),uiReadyPromise:Promise.resolve()},
  Services:{scriptloader:{loadSubScript:uri=>{if(uri.endsWith('updates.js'))throw Error('broken');}}},
  PDFRepair:class {async init(){initialized++;} async shutdown(){}}
 });context._globalThis=context;
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../.scaffold/build/addon/content/scripts/paddleocrrepair.js'),'utf8'),context);
 await context.addon.hooks.onStartup();assert.equal(initialized,1);assert.ok(context.Zotero.PaddleOCRRepair);
 await context.addon.hooks.onShutdown();
});
test('bootstrap subscript without DOM globals reuses host URL and UTF-8 constructors',async()=>{
 const hostWindow={URL,TextEncoder};
 const context=vm.createContext({Zotero:{getMainWindow:()=>hostWindow}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../plugin/content/updates.js'),'utf8'),context);
 assert.equal(context.POCRUpdates.validateConfig(config).latestReleaseUrl,config.latestReleaseUrl);
 const http=httpFixture();assert.equal((await context.POCRUpdates.requestJSON(http.http,config,()=>{},metadataUrl)).latestVersion,data.latestVersion);
});
