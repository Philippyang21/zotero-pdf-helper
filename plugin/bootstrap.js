/* global Zotero, Services, IOUtils, PathUtils, Cc, Ci, ChromeUtils */
'use strict';
var Repair;
var chromeHandle;

async function startup({id,version,rootURI}) {
  const aom = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
  chromeHandle = aom.registerChrome(Services.io.newURI(rootURI+'manifest.json'),[
    ['content','paddleocrrepair','content/']
  ]);
  Services.scriptloader.loadSubScript(rootURI+'repair.js',this);
  try {
    for(const name of ['options','protected','lineBreaks','whitespace','punctuation','index','annotations'])
      Services.scriptloader.loadSubScript(rootURI+'content/text/'+name+'.js',this);
    Services.scriptloader.loadSubScript(rootURI+'content/textUI.js',this);
  } catch (_) { Zotero.logError(new Error('引用文本整理未能载入，OCR 功能仍可使用。')); }
  Repair = new PDFRepair({id,version,rootURI});
  try {
    Services.scriptloader.loadSubScript(rootURI+'content/updates.js',this);
    Repair.updates = POCRUpdates.forZotero(Repair);
  } catch (_) { Zotero.logError(new Error('检查更新模块未能载入，OCR 功能仍可使用。')); }
  Zotero.PaddleOCRRepair = Repair;
  await Repair.init();
}
function onMainWindowLoad({window}) { Repair?.addWindow(window); }
function onMainWindowUnload({window}) { Repair?.removeWindow(window); }
async function shutdown() {
  await Repair?.shutdown();
  delete Zotero.PaddleOCRRepair;
  Repair = null;
  chromeHandle?.destruct();
  chromeHandle = null;
}
function install() {}
function uninstall() {}
