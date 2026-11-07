'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepare,replace}=require('../scripts/release-replacement.cjs');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function fixture(t){
 const scratch=path.resolve(__dirname,'../work/test-temp');fs.mkdirSync(scratch,{recursive:true});
 const root=fs.mkdtempSync(path.join(scratch,'release-replacement-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),scratch);fs.rmSync(root,{recursive:true,force:true});});
 const names=['pdf-helper-0.1.18.xpi','pdf-helper-0.1.18-source.zip','pdf-helper-0.1.18-bundle.zip','SHA256SUMS.txt'];
 const old=new Map(names.map(n=>[n,Buffer.from('old '+n)])),data=new Map(names.map(n=>[n,Buffer.from('new '+n)]));
 data.set('SHA256SUMS.txt',Buffer.from(names.slice(0,3).map(n=>sha(data.get(n))+'  '+n+'\n').join('')));
 let tag='a'.repeat(40),next=10;const newCommit='b'.repeat(40),calls=[];
 const release={id:437389043,tag_name:'v0.1.18',draft:false,prerelease:false,immutable:false,name:'PDF OCR Helper 0.1.18',body:'old notes',html_url:'https://github.com/owner/repo/releases/tag/v0.1.18',assets:names.map((name,i)=>({name,id:i+1,size:old.get(name).length,digest:'sha256:'+sha(old.get(name)),browser_download_url:'https://github.com/owner/repo/releases/download/v0.1.18/'+name}))};
 const config={tag:'v0.1.18',releaseId:release.id,expectedTagSha:tag,assets:release.assets.map(a=>({name:a.name,id:a.id,size:a.size,sha256:a.digest.slice(7)}))};
 const repos={
  getReleaseByTag:async()=>({data:structuredClone(release)}),
  listReleaseAssets:async()=>({data:structuredClone(release.assets)}),
  uploadReleaseAsset:async({name,data:bytes})=>{calls.push(['upload',name]);const a={name,id:next++,size:bytes.length,digest:'sha256:'+sha(bytes)};release.assets.push(a);return {data:structuredClone(a)};},
  deleteReleaseAsset:async({asset_id})=>{calls.push(['delete',asset_id]);const i=release.assets.findIndex(a=>a.id===asset_id);assert.ok(i>=0);release.assets.splice(i,1);},
  updateReleaseAsset:async({asset_id,name})=>{calls.push(['rename',asset_id,name]);const a=release.assets.find(a=>a.id===asset_id);a.name=name;return {data:structuredClone(a)};},
  updateRelease:async values=>{calls.push(['release']);Object.assign(release,values);return {data:structuredClone(release)};}
 };
 const github={rest:{repos,git:{getRef:async()=>({data:{object:{type:'commit',sha:tag}}}),updateRef:async({sha})=>{calls.push(['tag',sha]);tag=sha;}}}};
 const artifactDir=path.join(root,'artifacts'),backupDir=path.join(root,'backup'),configPath=path.join(root,'config.json'),notesPath=path.join(root,'notes.md');
 fs.mkdirSync(artifactDir);for(const [name,bytes] of data)fs.writeFileSync(path.join(artifactDir,name),bytes);
 fs.writeFileSync(configPath,JSON.stringify(config));fs.writeFileSync(notesPath,'# Release\n\n- First update\n- Second update\n');
 const options={github,owner:'owner',repo:'repo',tag:'v0.1.18',commit:newCommit,configPath,backupDir,artifactDir,notesPath,runId:123};
 return {options,release,github,calls,config,old,data,names,backupDir,artifactDir,tag:()=>tag,setTag:value=>tag=value,
  prepare:()=>prepare({...options,download:async asset=>old.get(asset.name)}),replace:()=>replace(options)};
}
test('replacement preserves the release ID, stages before deleting, and updates all bytes plus the tag',async t=>{
 const f=fixture(t);await f.prepare();assert.equal(f.calls.length,0);
 const r=await f.replace();assert.equal(r.releaseId,437389043);assert.equal(f.tag(),'b'.repeat(40));
 for(const a of f.release.assets)assert.equal(a.digest,'sha256:'+sha(f.data.get(a.name)));
 assert.equal(f.calls.filter(c=>c[0]==='upload').length,4);
 assert.ok(f.calls.slice(0,4).every(c=>c[0]==='upload'&&c[1].startsWith('replacement-123-')));
 assert.equal(f.release.body.split('\n').filter(s=>s.startsWith('- ')).length,2);
 for(const name of f.names)assert.deepEqual(fs.readFileSync(path.join(f.backupDir,name)),f.old.get(name));
});
test('wrong release, asset or tag identities block backup without mutating remote state',async t=>{
 for(const type of ['release','asset','tag','immutable']){
  const f=fixture(t);if(type==='release')f.release.id=1;if(type==='asset')f.release.assets[0].digest='sha256:'+'0'.repeat(64);
  if(type==='tag')f.setTag('c'.repeat(40));if(type==='immutable')f.release.immutable=true;
  await assert.rejects(f.prepare);assert.equal(f.calls.length,0);
 }
});
test('a backup checksum failure stops before remote writes',async t=>{
 const f=fixture(t);await assert.rejects(()=>prepare({...f.options,download:async()=>Buffer.from('wrong backup')}));assert.equal(f.calls.length,0);
});
test('corrupted rollback files or new checksums block staging',async t=>{
 for(const type of ['backup','new']){
  const f=fixture(t);await f.prepare();fs.writeFileSync(path.join(type==='backup'?f.backupDir:f.artifactDir,f.names[0]),'corrupt');
  await assert.rejects(f.replace);assert.equal(f.calls.length,0);
 }
});
test('a concurrent tag change is rejected before staging',async t=>{
 const f=fixture(t);await f.prepare();f.setTag('c'.repeat(40));await assert.rejects(f.replace);assert.equal(f.calls.length,0);
});
test('staging failure removes only staged files and leaves the published release intact',async t=>{
 const f=fixture(t);await f.prepare();const original=f.github.rest.repos.uploadReleaseAsset;let count=0;
 f.github.rest.repos.uploadReleaseAsset=async args=>{if(++count===2)throw Error('upload interrupted');return original(args);};
 await assert.rejects(f.replace,/preserved or restored/);assert.equal(f.tag(),'a'.repeat(40));
 assert.deepEqual(f.release.assets.map(a=>a.name).sort(),[...f.names].sort());
 for(const a of f.release.assets)assert.equal(a.digest,'sha256:'+sha(f.old.get(a.name)));
});
test('a rename failure after switching rolls back the tag, old bytes and release notes',async t=>{
 const f=fixture(t);await f.prepare();const original=f.github.rest.repos.updateReleaseAsset;let fail=true;
 f.github.rest.repos.updateReleaseAsset=async args=>{if(fail){fail=false;throw Error('rename interrupted');}return original(args);};
 await assert.rejects(f.replace,/preserved or restored/);assert.equal(f.tag(),'a'.repeat(40));assert.equal(f.release.body,'old notes');
 assert.deepEqual(f.release.assets.map(a=>a.name).sort(),[...f.names].sort());
 for(const a of f.release.assets)assert.equal(a.digest,'sha256:'+sha(f.old.get(a.name)));
});
test('a failure updating release notes also restores all original assets',async t=>{
 const f=fixture(t);await f.prepare();const original=f.github.rest.repos.updateRelease;let fail=true;
 f.github.rest.repos.updateRelease=async args=>{if(fail){fail=false;throw Error('API interrupted');}return original(args);};
 await assert.rejects(f.replace,/preserved or restored/);assert.equal(f.tag(),'a'.repeat(40));assert.equal(f.release.body,'old notes');
 for(const a of f.release.assets)assert.equal(a.digest,'sha256:'+sha(f.old.get(a.name)));
});
