'use strict';
// Local-only template build. No release, tag, commit, push, install or serve command.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,NODE_ENV:'production'};
env.SWC_NATIVE_BINDING_CACHE ||= path.join(root,'work','swc-native-cache');
function run(command,args){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
const python=[process.env.PDF_HELPER_PYTHON,'python','python3'].filter(Boolean).find(command=>
  spawnSync(command,['-c','import sys; assert sys.version_info >= (3,10)'],{cwd:root,env,windowsHide:true}).status===0);
if(!python)throw new Error('Install Python 3.10+ or set PDF_HELPER_PYTHON to its executable.');
for(const file of ['node_modules/zotero-plugin-scaffold/bin/zotero-plugin.mjs','node_modules/typescript/bin/tsc'])
  if(!fs.existsSync(path.join(root,file)))throw new Error('Install build dependencies with pnpm install --frozen-lockfile first.');
run(python,['-B','scripts/prepare_helper.py']);
run(process.execPath,['node_modules/zotero-plugin-scaffold/bin/zotero-plugin.mjs','build']);
run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit']);
run(python,['-B','scripts/verify_template.py']);
