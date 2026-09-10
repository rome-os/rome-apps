// User rslib config, merged by the Rome app-web-sdk into its generated base
// config via mergeRslibConfig(baseConfig, userConfig). The base config has no
// `id` on its libs, so mergeLibConfigs APPENDS the lib below — the final lib
// array becomes [webLib (index), backendLib, lessonRuntimeLib]. This ADDS a
// second web bundle WITHOUT touching the existing `index` build or the backend
// lib build.
//
// Why a SEPARATE lib (not a second entry on the web lib):
//  - The web lib carries RomeAppManifestPlugin, which picks the FIRST initial
//    chunk as the manifest `entry` and lists ALL emitted CSS as `styles`. A
//    second entry there would corrupt manifest.json. This lib has no such
//    plugin, so it only drops lesson-runtime.js into dist/web.
//  - Output is IIFE (classic script), NOT ESM: the lesson iframe is sandboxed
//    with `allow-scripts` only (null origin), so a `<script type=module>` would
//    be a CORS request the app-assets route rejects, while a classic
//    `<script src>` loads cross-origin fine. IIFE also self-executes on load.
//  - Everything (Shiki + Mermaid) is bundled into the one file; asyncChunks is
//    disabled so no code-split chunk is emitted (a null-origin srcdoc could not
//    fetch one).
//  - cleanDistPath is false; the web lib already cleans dist/web up-front
//    (cleaning runs before any emit), so this lib's output survives.
//
// Kept dependency-light on purpose: the root tsconfig excludes this file from
// typecheck (include: ["src/**/*"]), and @rslib/core is only a transitive dep,
// so we export a plain object instead of importing defineConfig.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Shared shape for the two extra web bundles. Both are classic IIFEs (the
// lesson iframe is a null-origin `allow-scripts` sandbox, where a module script
// or a code-split chunk could not be fetched) with asyncChunks disabled so each
// emits exactly one self-executing file into dist/web.
function iifeLib(name: string, entry: string) {
  return {
    format: "iife" as const,
    bundle: true,
    autoExternal: false,
    source: {
      entry: { [name]: resolve(here, entry) },
    },
    output: {
      target: "web" as const,
      minify: true,
      externals: "",
      distPath: { root: resolve(here, "dist/web") },
      cleanDistPath: false,
      sourceMap: false,
    },
    tools: {
      rspack: {
        output: { asyncChunks: false },
      },
    },
  };
}

export default {
  lib: [
    // Core runtime loaded by EVERY lesson: Shiki highlight + component
    // hydration + the host bridge. Mermaid is no longer bundled here.
    iifeLib("lesson-runtime", "src/web/lesson-runtime/index.ts"),
    // Mermaid, split out so it is fetched ONLY when a lesson has a diagram. The
    // core runtime injects it from this sibling URL on demand.
    iifeLib("lesson-mermaid", "src/web/lesson-runtime/mermaid-bundle.ts"),
  ],
};
