'use strict';
// Render the real status page with explicit example data, without a Zotero session.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.argv[2]||path.join(root,'work','status-preview.html'));
const job={id:'example-only',state:'recognizing',mode:'ocr',target:'example-library/示例文献（非真实任务）.pdf',pages:654,model:'PP-StructureV3',sidecars:'archive',apiSeconds:990,pdfSeconds:0,
 progress:{stage:'remote',completed:200,resultPages:163,known:true},parts:[
  {start:0,end:163,state:'done',phase:'done',timing:{uploading:4,pending:600,running:300,downloading:3},batchID:'example-1'},
  {start:163,end:327,state:'accepted',phase:'running',remoteProgress:{completed:37,total:164},lastChecked:new Date().toISOString(),timing:{uploading:4,pending:20,running:60},batchID:'example-2'},
  {start:327,end:490,state:'accepted',phase:'pending',lastChecked:new Date().toISOString(),timing:{uploading:4,pending:75},batchID:'example-3'},
  {start:490,end:654,state:'new',batchID:'example-4'}
 ]};
let html=fs.readFileSync(path.join(root,'plugin/content/status.xhtml'),'utf8')
 .replace(/<\?[^>]*\?>/g,'').replace(/<window[^>]*>/,'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>')
 .replace(/<\/window>/,'</body></html>').replace(/(<\/?)(?:html:)/g,'$1')
 .replace(/<script src="[^"]*"\s*\/>/g,'').replace('<h1>PDF OCR Helper</h1>','<h1>PDF OCR Helper · 0.1.7 示例预览</h1>');
const init=`window.arguments=[{repair:{state:${JSON.stringify({jobs:[job],usage:{},dailyThreshold:20000})},finalizePhase:new Map(),finalizeErrors:new Map(),receipts:{},busyMessage:'',ensure:async()=>{},tick:async()=>{}}}];`;
const scripts=init+'\n'+fs.readFileSync(path.join(root,'plugin/content/progress.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'plugin/content/status.js'),'utf8');
html=html.replace('</body>',`<script>${scripts}</script></body>`);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(output);
