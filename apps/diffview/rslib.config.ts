import { defineConfig } from "@rome-os/app-web-sdk/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "shiki/langs$": resolve("src/web/languages.ts"),
    },
  },
});
