import { createRepairRuntime } from "./modules/runtime";

let runtimeInitialization: Promise<void> | undefined;

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  if (!addon.data.alive) return;
  const repair = createRepairRuntime();
  addon.data.repair = repair;
  (Zotero as unknown as Record<string, unknown>).PaddleOCRRepair = repair;
  runtimeInitialization = repair.init();
  await runtimeInitialization;
  if (addon.data.alive) addon.data.initialized = true;
}

function onMainWindowLoad(window: _ZoteroTypes.MainWindow) {
  if (addon.data.alive) addon.data.repair?.addWindow(window);
}

function onMainWindowUnload(window: _ZoteroTypes.MainWindow) {
  addon.data.repair?.removeWindow(window);
}

async function onShutdown() {
  if (!addon.data.alive) return;
  addon.data.alive = false;
  addon.data.initialized = false;
  const host = Zotero as unknown as Record<string, unknown>;
  try {
    // A disabled plugin must not finish registering menus after shutdown.
    // Do not await the host-readiness gate when no runtime exists yet.
    try { await runtimeInitialization; } catch { /* Still clean up a partially initialized runtime. */ }
    await addon.data.repair?.shutdown();
  } finally {
    if (host.PaddleOCRRepair === addon.data.repair) delete host.PaddleOCRRepair;
    if (host[addon.data.config.addonInstance] === addon) delete host[addon.data.config.addonInstance];
  }
}

export default { onStartup, onShutdown, onMainWindowLoad, onMainWindowUnload };
