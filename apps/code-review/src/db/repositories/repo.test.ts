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

  it("defaults newly configured repositories to everyone except blocked", () => {
    const repository = createScanRepository(appDb);
    const created = repository.upsertPRReviewSettings("rome-os/new-repo", { autoReviewEnabled: true });
    expect(created.triggerAccessMode).toBe("blocklist");
    expect(createScanRepository(appDb).getPRReviewSettings("rome-os/new-repo")?.triggerAccessMode).toBe("blocklist");
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

describe("ScanRepository PR history", () => {
  let sqlite: Database.Database;
  let appDb: AppDbContext;

  beforeEach(() => {
    ({ sqlite, appDb } = createTestContext());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("returns only the reviews and PR mention tasks for one repo + PR pair, oldest first", () => {
    const repository = createScanRepository(appDb);
    const first = repository.createQueuedPRReview({ repo: "rome-os/rome", prNumber: 7 });
    const second = repository.createQueuedPRReview({ repo: "rome-os/rome", prNumber: 7 });
    sqlite.prepare(`UPDATE repo_guardian__pr_reviews SET started_at = ? WHERE id = ?`).run("2026-01-01T00:00:00.000Z", first.id);
    sqlite.prepare(`UPDATE repo_guardian__pr_reviews SET started_at = ? WHERE id = ?`).run("2026-01-02T00:00:00.000Z", second.id);
    repository.createQueuedPRReview({ repo: "rome-os/rome", prNumber: 8 });
    repository.createQueuedPRReview({ repo: "rome-os/other", prNumber: 7 });

    const question = repository.createMentionTask({ repo: "rome-os/rome", surface: "pr", number: 7, intent: "general" });
    repository.createMentionTask({ repo: "rome-os/rome", surface: "issue", number: 7, intent: "general" });
    repository.createMentionTask({ repo: "rome-os/rome", surface: "pr", number: 8, intent: "general" });

    expect(repository.listPRReviewsForPR("rome-os/rome", 7).map((r) => r.id)).toEqual([first.id, second.id]);
    expect(repository.listMentionTasksForPR("rome-os/rome", 7).map((t) => t.id)).toEqual([question.id]);
  });

  it("matches repository names case-insensitively, like GitHub", () => {
    const repository = createScanRepository(appDb);
    const review = repository.createQueuedPRReview({ repo: "Rome-OS/Rome", prNumber: 7 });
    const task = repository.createMentionTask({ repo: "rome-os/ROME", surface: "pr", number: 7, intent: "general" });

    expect(repository.listPRReviewsForPR("rome-os/rome", 7).map((r) => r.id)).toEqual([review.id]);
    expect(repository.listMentionTasksForPR("ROME-OS/rome", 7).map((t) => t.id)).toEqual([task.id]);
  });
});

describe("ScanRepository app settings", () => {
  it("stores and overwrites a setting", () => {
    const { sqlite, appDb } = createTestContext();
    const repository = createScanRepository(appDb);
    expect(repository.getAppSetting("public_origin")).toBeNull();
    repository.setAppSetting("public_origin", "https://a.romeos.cc");
    repository.setAppSetting("public_origin", "https://b.romeos.cc");
    expect(createScanRepository(appDb).getAppSetting("public_origin")).toBe("https://b.romeos.cc");
    sqlite.close();
  });
});
