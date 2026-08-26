import "dotenv/config";
import { join } from "path";
import { homedir } from "os";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  migrations: { table: "__drizzle_migrations_app_news" },
  tablesFilter: ["news__reddit_posts"],
  dbCredentials: {
    url:
      process.env.SQLITE_PATH ??
      join(homedir(), ".rome", process.env.ROME_PROFILE || "default", "rome.db"),
  },
});
