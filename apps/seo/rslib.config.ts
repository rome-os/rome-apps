import { defineConfig } from "@rome-os/app-web-sdk/config";

export default defineConfig({
  // Keep the ESM runtime separate from modules used by both the initial
  // dashboard and lazy Markdown plugins; this avoids a circular runtime import.
  tools: {
    rspack: (config) => {
      if (config.output?.module) {
        config.optimization ??= {};
        config.optimization.runtimeChunk = { name: "seo-runtime" };
      }
    },
  },
  performance: { buildCache: false },
});
