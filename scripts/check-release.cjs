'use strict';
// Offline preflight. --ready is a gate, never a publisher or a network probe.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const U=require('../plugin/content/updates.js');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const manifest=JSON.parse(read('plugin/manifest.json')),meta=manifest.applications.zotero;
const config=JSON.parse(read('plugin/update-config.json')),feed=JSON.parse(read('release/update-manifest.json'));
assert.equal(U.compareVersions(manifest.version,manifest.version),0);
assert.equal(read('helper/repair/__init__.py').match(/__version__ = '([^']+)'/)[1],manifest.version,'Helper version');
assert.equal(feed.latestVersion,manifest.version,'Candidate feed version');assert.equal(feed.addonId,meta.id,'Addon identity');
assert.equal(feed.minZoteroVersion,meta.strict_min_version,'Min Zotero version');
assert.equal(feed.maxZoteroVersion,meta.strict_max_version,'Max Zotero version');
assert.equal(meta.update_url,'https://paddleocr-pdf-repair.invalid/updates.json','Preserve the required legacy HTTPS placeholder; manual updates use update-config.json');
assert.ok(read('CHANGELOG.md').includes('## '+manifest.version));
assert.ok(fs.existsSync(path.join(root,'docs/CHANGELOG-'+manifest.version+'.md')));
const pending=[];
for(const field of ['repositoryUrl','manifestUrl','communityUrl'])if(!config[field])pending.push(field);
if(!feed.published)pending.push('published=false (candidate only)');
if(!feed.communityUrl)pending.push('feed.communityUrl');
if(!pending.length){
 const checked=U.validateConfig(config);
 // Exact build range has already been checked against the installed manifest above.
 U.validateManifest(feed,checked,meta.id,()=>0);
} else {
 // Null URLs intentionally represent missing configuration; reject partially filled unsafe values.
 if(config.repositoryUrl || config.manifestUrl || config.communityUrl)U.validateConfig(config);
 assert.equal(feed.published,false,'Incomplete configuration must stay unpublished');
}
console.log(JSON.stringify({version:manifest.version,zotero:meta,ready:pending.length===0,pending},null,2));
if(process.argv.includes('--ready') && pending.length){console.error('Release is not configured; see docs/RELEASING.md.');process.exitCode=1;}
