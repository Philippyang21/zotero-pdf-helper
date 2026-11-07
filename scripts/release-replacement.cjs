'use strict';
// Explicit same-version replacement with verified backup, staging and rollback.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const namesFor=tag=>['.xpi','-source.zip','-bundle.zip'].map(s=>'pdf-helper-'+tag.slice(1)+s).concat('SHA256SUMS.txt');
function validateConfig(config,tag){
  assert.equal(config.tag,tag);assert.match(tag,/^v\d+\.\d+\.\d+$/);
  assert.match(config.expectedTagSha,/^[a-f0-9]{40}$/);assert.ok(Number.isSafeInteger(config.releaseId));
  assert.deepEqual(config.assets.map(a=>a.name).sort(),namesFor(tag).sort());
  for(const a of config.assets){assert.ok(Number.isSafeInteger(a.id)&&a.size>0);assert.match(a.sha256,/^[a-f0-9]{64}$/);}
}
function validateRelease(release,config,tagSha,stagedPrefix=''){
  assert.equal(release.id,config.releaseId,'Release identity changed');assert.equal(release.tag_name,config.tag);
  assert.ok(!release.draft&&!release.prerelease&&!release.immutable,'Release must be mutable and public');
  assert.equal(tagSha,config.expectedTagSha,'Published tag changed');
  const assets=release.assets.filter(a=>!stagedPrefix||!a.name.startsWith(stagedPrefix));
  assert.deepEqual(assets.map(a=>a.name).sort(),config.assets.map(a=>a.name).sort(),'Published asset set changed');
  for(const expected of config.assets){
    const actual=assets.find(a=>a.name===expected.name);
    assert.equal(actual.id,expected.id,'Published asset identity changed');assert.equal(actual.size,expected.size);
    assert.equal(actual.digest,'sha256:'+expected.sha256,'Published asset digest changed');
  }
}
async function tagSha(github,owner,repo,tag){
  const {data}=await github.rest.git.getRef({owner,repo,ref:'tags/'+tag});
  assert.equal(data.object.type,'commit','Replacement expects the reviewed lightweight tag');return data.object.sha;
}
async function prepare({github,owner,repo,tag,commit,configPath,backupDir,download}){
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));validateConfig(config,tag);
  assert.match(commit,/^[a-f0-9]{40}$/);assert.notEqual(commit,config.expectedTagSha);
  const release=(await github.rest.repos.getReleaseByTag({owner,repo,tag})).data;
  validateRelease(release,config,await tagSha(github,owner,repo,tag));
  fs.mkdirSync(backupDir,{recursive:true});
  for(const expected of config.assets){
    const asset=release.assets.find(a=>a.id===expected.id);
    const url=`https://github.com/${owner}/${repo}/releases/download/${tag}/${expected.name}`;
    assert.equal(asset.browser_download_url,url,'Unexpected backup URL');
    const bytes=download?await download(asset):Buffer.from(await (await fetch(url,{signal:AbortSignal.timeout(60000)})).arrayBuffer());
    assert.equal(bytes.length,expected.size);assert.equal(digest(bytes),expected.sha256,'Backup checksum mismatch');
    fs.writeFileSync(path.join(backupDir,expected.name),bytes,{flag:'wx'});
  }
  const manifest={schema:1,owner,repo,tag,newCommit:commit,config,release};
  fs.writeFileSync(path.join(backupDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {releaseId:release.id,oldCommit:config.expectedTagSha,backedUp:config.assets.length};
}
function readArtifacts(dir,tag){
  const names=namesFor(tag);assert.deepEqual(fs.readdirSync(dir).filter(n=>fs.statSync(path.join(dir,n)).isFile()).sort(),[...names].sort());
  const files=new Map(names.map(name=>[name,fs.readFileSync(path.join(dir,name))]));
  const sums=files.get('SHA256SUMS.txt').toString('ascii').trim().split(/\r?\n/).map(line=>line.split('  '));
  assert.deepEqual(sums.map(v=>v[1]).sort(),names.filter(n=>n!=='SHA256SUMS.txt').sort());
  for(const [sum,name] of sums)assert.equal(digest(files.get(name)),sum,'New artifact checksum mismatch');
  return files;
}
async function replace({github,owner,repo,tag,commit,backupDir,artifactDir,notesPath,runId}){
  assert.match(String(runId),/^\d+$/);const prefix=`replacement-${runId}-`;
  const manifest=JSON.parse(fs.readFileSync(path.join(backupDir,'manifest.json'),'utf8'));
  assert.equal(manifest.schema,1);assert.equal(manifest.owner,owner);assert.equal(manifest.repo,repo);
  assert.equal(manifest.tag,tag);assert.equal(manifest.newCommit,commit);
  const {config,release:original}=manifest;validateConfig(config,tag);
  for(const a of config.assets)assert.equal(digest(fs.readFileSync(path.join(backupDir,a.name))),a.sha256,'Backup was changed');
  const files=readArtifacts(artifactDir,tag);
  let current=(await github.rest.repos.getReleaseByTag({owner,repo,tag})).data;
  validateRelease(current,config,await tagSha(github,owner,repo,tag));assert.equal(current.body,original.body,'Release notes changed');
  const staged=new Map();let moved=false;
  const upload=async(name,data)=>{
    const asset=(await github.rest.repos.uploadReleaseAsset({owner,repo,release_id:config.releaseId,name,data})).data;
    assert.equal(asset.size,data.length);assert.equal(asset.digest,'sha256:'+digest(data),'Uploaded bytes did not match');return asset;
  };
  const cleanup=async()=>{
    const assets=(await github.rest.repos.listReleaseAssets({owner,repo,release_id:config.releaseId})).data;
    for(const a of assets)if(a.name.startsWith(prefix))await github.rest.repos.deleteReleaseAsset({owner,repo,asset_id:a.id});
  };
  try{
    for(const [name,data] of files)staged.set(name,await upload(prefix+name,data));
    current=(await github.rest.repos.getReleaseByTag({owner,repo,tag})).data;
    validateRelease(current,config,await tagSha(github,owner,repo,tag),prefix);
    assert.equal(current.body,original.body,'Release notes changed while staging');
    await github.rest.git.updateRef({owner,repo,ref:'tags/'+tag,sha:commit,force:true});moved=true;
    for(const expected of config.assets){
      await github.rest.repos.deleteReleaseAsset({owner,repo,asset_id:expected.id});
      await github.rest.repos.updateReleaseAsset({owner,repo,asset_id:staged.get(expected.name).id,name:expected.name});
    }
    let body=fs.readFileSync(notesPath,'utf8').trim()+'\n\n| File | Bytes | SHA-256 |\n| --- | ---: | --- |\n';
    for(const [name,data] of files)body+=`| ${name} | ${data.length} | ${digest(data)} |\n`;
    await github.rest.repos.updateRelease({owner,repo,release_id:config.releaseId,target_commitish:commit,
      name:`PDF OCR Helper ${tag.slice(1)}`,body,draft:false,prerelease:false,make_latest:'true'});
    const final=(await github.rest.repos.getReleaseByTag({owner,repo,tag})).data;
    assert.equal(await tagSha(github,owner,repo,tag),commit);
    assert.deepEqual(final.assets.map(a=>a.name).sort(),[...files.keys()].sort());
    for(const [name,data] of files){const a=final.assets.find(a=>a.name===name);assert.equal(a.digest,'sha256:'+digest(data));assert.equal(a.size,data.length);}
    return {url:final.html_url,releaseId:final.id,oldCommit:config.expectedTagSha,newCommit:commit,replacedAssets:files.size};
  }catch(error){
    // Before the tag switch, cleanup affects only this run's staged uploads.
    // After the switch, restore all old bytes and their original tag/notes.
    try{
      if(moved){
        await github.rest.git.updateRef({owner,repo,ref:'tags/'+tag,sha:config.expectedTagSha,force:true});
        for(const expected of config.assets){
          const assets=(await github.rest.repos.listReleaseAssets({owner,repo,release_id:config.releaseId})).data;
          const existing=assets.find(a=>a.name===expected.name);
          if(existing?.digest==='sha256:'+expected.sha256)continue;
          if(existing)await github.rest.repos.deleteReleaseAsset({owner,repo,asset_id:existing.id});
          await upload(expected.name,fs.readFileSync(path.join(backupDir,expected.name)));
        }
        await github.rest.repos.updateRelease({owner,repo,release_id:config.releaseId,name:original.name,body:original.body,
          target_commitish:config.expectedTagSha,draft:false,prerelease:false,make_latest:'true'});
      }
      await cleanup();
    }catch(rollbackError){throw new AggregateError([error,rollbackError],'Replacement failed; rollback requires the saved backup');}
    throw new Error('Replacement failed; old published release preserved or restored',{cause:error});
  }
}
module.exports={prepare,replace,validateConfig,validateRelease,readArtifacts};
