// Adapted from windingwind/zotero-plugin-template, commit 306d4e2a0959a7b2f5e44bb38169fb25f841dbaf.
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "plugin"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: `pdf-helper-${pkg.version}`,
  updateURL: "https://paddleocr-pdf-repair.invalid/updates.json",
  build: {
    assets: [
      "plugin/{bootstrap.js,manifest.json,prefs.js,repair.js,update-config.json,helper-source.zip}",
      "plugin/content/**/*.{js,xhtml,css}",
      "plugin/icons/*.png",
      "README.md", "LICENSE", "docs/**/*.md", "docs/images/*.png", "docs/licenses/*.txt",
    ],
    define: { ...pkg.config, author: pkg.author, description: pkg.description, buildVersion: pkg.version },
    prefs: { prefix: pkg.config.prefsPrefix, prefixPrefKeys: false, dts: false },
    fluent: { dts: false },
    esbuildOptions: [{
      entryPoints: ["src/index.ts"],
      define: { __env__: JSON.stringify("production") },
      bundle: true,
      target: "firefox115",
      outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
    }],
  },
  release: {
    github: { enable: "false", updater: false },
    hooks: { "release:init": () => { throw new Error("Use the reviewed manual Release procedure in docs/RELEASING.md."); } },
  },
});
