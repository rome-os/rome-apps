import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  migrations: { table: "__drizzle_migrations_app_yt_distill" },
  tablesFilter: ["yt_distill\\__*"],
});
