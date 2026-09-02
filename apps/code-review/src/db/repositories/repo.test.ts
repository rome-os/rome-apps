import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createScanRepository } from "./repo.js";

function applyMigrations(sqlite: Database.Database): void {
  const migrationsDir = new URL("../migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
}

function createTestContext(): {
  sqlite: Database.Database;
  appDb: AppDbContext;
} {
  const sqlite = new Database(":memory:");
  applyMigrations(sqlite);
  const connection = drizzle(sqlite) as unknown as DrizzleDb;
  return {
    sqlite,
    appDb: {
      connection,
      tablePrefix: "repo_guardian",
      tableName(name: string) {
        return `repo_guardian__${name}`;
      },
    },
  };
}

describe("ScanRepository trigger access policy", () => {
  let sqlite: Database.Database;
  let appDb: AppDbContext;

  beforeEach(() => {
    ({ sqlite, appDb } = createTestContext());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("preserves both lists and the compatibility alias across partial mode switches", () => {
    const repository = createScanRepository(appDb);
    const repo = "rome-os/rome";

    const created = repository.upsertPRReviewSettings(repo, {
      triggerAccessMode: "allowlist",
      triggerAllowlist: ["@Alice", "bob", "alice"],
      triggerBlocklist: ["Mallory", "eve", "mallory"],
    });
    expect(created).toMatchObject({
      triggerAccessMode: "allowlist",
      triggerAllowlist: ["alice", "bob"],
      manualTriggerAllowlist: ["alice", "bob"],
      triggerBlocklist: ["mallory", "eve"],
    });

    const opened = repository.upsertPRReviewSettings(repo, {
      triggerAccessMode: "blocklist",
    });
    expect(opened).toMatchObject({
      triggerAccessMode: "blocklist",
      triggerAllowlist: ["alice", "bob"],
      manualTriggerAllowlist: ["alice", "bob"],
      triggerBlocklist: ["mallory", "eve"],
    });

    repository.upsertPRReviewSettings(repo, {
      triggerBlocklist: ["Trent"],
    });
    repository.upsertPRReviewSettings(repo, {
      triggerAccessMode: "allowlist",
    });

    // Recreate the repository to prove the contract survives serialization,
    // not just the return value of the merge path.
    const reloaded = createScanRepository(appDb).getPRReviewSettings(repo);
    expect(reloaded).toMatchObject({
      triggerAccessMode: "allowlist",
      triggerAllowlist: ["alice", "bob"],
      manualTriggerAllowlist: ["alice", "bob"],
      triggerBlocklist: ["trent"],
    });
  });
});
