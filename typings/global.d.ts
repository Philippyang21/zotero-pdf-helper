import type Addon from "../src/addon";
import type { LegacyRepair } from "../src/modules/runtime";

declare global {
  const __env__: "production" | "development";
  const rootURI: string;
  const addon: Addon;
  const _globalThis: {
    rootURI: string;
    addon: Addon;
    PDFRepair: new (options: { id: string; version: string; rootURI: string }) => LegacyRepair;
    POCRUpdates?: { forZotero(repair: LegacyRepair): unknown };
    [key: string]: unknown;
  };
}
