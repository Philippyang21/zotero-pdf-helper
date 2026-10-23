// Entry pattern adapted from Zotero Plugin Template; keep the legacy public API separate.
import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const toolkit = new BasicTool();
const host = toolkit.getGlobal("Zotero") as unknown as Record<string, unknown>;
if (!host[config.addonInstance]) {
  _globalThis.addon = new Addon(toolkit);
  host[config.addonInstance] = _globalThis.addon;
} else {
  _globalThis.addon = host[config.addonInstance] as Addon;
}
