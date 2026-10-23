import { BasicTool } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import hooks from "./hooks";
import type { LegacyRepair } from "./modules/runtime";

export default class Addon {
  public data: {
    alive: boolean;
    initialized: boolean;
    config: typeof config;
    env: "production" | "development";
    toolkit: BasicTool;
    repair?: LegacyRepair;
  };
  public hooks = hooks;
  public api = {};

  constructor(toolkit: BasicTool) {
    toolkit.basicOptions.api.pluginID = config.addonID;
    toolkit.basicOptions.log.disableConsole = true;
    this.data = { alive: true, initialized: false, config, env: __env__, toolkit };
  }
}
