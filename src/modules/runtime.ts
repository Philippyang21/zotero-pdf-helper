import { config, version } from "../../package.json";

export interface LegacyRepair {
  init(): Promise<void>;
  shutdown(): Promise<void>;
  addWindow(window: _ZoteroTypes.MainWindow): void;
  removeWindow(window: _ZoteroTypes.MainWindow): void;
  updates?: unknown;
}

export function createRepairRuntime(): LegacyRepair {
  const load = (name: string) => Services.scriptloader.loadSubScript(rootURI + name, _globalThis);
  load("repair.js");
  try {
    for (const name of ["options", "protected", "lineBreaks", "whitespace", "punctuation", "index", "annotations"])
      load(`content/text/${name}.js`);
    load("content/textUI.js");
  } catch {
    Zotero.logError(new Error("引用文本整理未能载入，OCR 功能仍可使用。"));
  }
  const repair = new _globalThis.PDFRepair({ id: config.addonID, version, rootURI });
  try {
    load("content/updates.js");
    repair.updates = _globalThis.POCRUpdates?.forZotero(repair);
  } catch {
    Zotero.logError(new Error("检查更新模块未能载入，OCR 功能仍可使用。"));
  }
  return repair;
}
