/* global Zotero, Services, Cc, Ci */
// Adapted from windingwind/zotero-plugin-template/addon/bootstrap.js (AGPL-3.0-or-later).
// Upstream derives this bootstrap from Zotero's Make It Red example and developer docs.
'use strict';
var chromeHandle;
var pluginContext;
var pluginStartup;
var pluginStartupCleanup;

async function startup({id,version,rootURI}) {
  const aom = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
  chromeHandle = aom.registerChrome(Services.io.newURI(rootURI+'manifest.json'),[
    ['content','paddleocrrepair','content/']
  ]);
  const ctx={rootURI};
  for(const name of ['Zotero','Services','IOUtils','PathUtils','Cc','Ci','ChromeUtils','Components',
    'setTimeout','clearTimeout','setInterval','clearInterval','console'])
    if(name in globalThis)ctx[name]=globalThis[name];
  ctx._globalThis=ctx;
  pluginContext=ctx;
  try {
    Services.scriptloader.loadSubScript(rootURI+'content/scripts/paddleocrrepair.js',ctx);
    // Zotero may await bootstrap startup before resolving its own readiness promises.
    // Keep readiness inside the hook, but never make host startup wait for that hook.
    pluginStartup=ctx.addon.hooks.onStartup();
    pluginStartupCleanup=pluginStartup.catch(async error=>{
      Zotero.logError(error);
      if(pluginContext!==ctx)return;
      try { await ctx.addon.hooks.onShutdown(); } catch(cleanupError) { Zotero.logError(cleanupError); } finally {
        if(pluginContext===ctx){chromeHandle?.destruct();chromeHandle=null;pluginContext=null;}
      }
    });
  } catch(error) {
    try { await ctx.addon?.hooks.onShutdown(); } finally {
      chromeHandle?.destruct();chromeHandle=null;pluginContext=null;
    }
    throw error;
  }
}
function onMainWindowLoad({window}) { return pluginContext?.addon.hooks.onMainWindowLoad(window); }
function onMainWindowUnload({window}) { return pluginContext?.addon.hooks.onMainWindowUnload(window); }
async function shutdown() {
  // Preserve the existing helper shutdown on both disable and application exit.
  try { await pluginContext?.addon.hooks.onShutdown(); } finally {
    pluginContext=null;chromeHandle?.destruct();chromeHandle=null;
  }
}
function install() {}
function uninstall() {}
