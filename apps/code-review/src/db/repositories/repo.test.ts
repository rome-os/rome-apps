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

describe("ScanRepository per-PR auto-review limit", () => {
  let sqlite: Database.Database;
  let appDb: AppDbContext;

  beforeEach(() => {
    ({ sqlite, appDb } = createTestContext());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("defaults a new repo to 5 and round-trips an edited value", () => {
    const repository = createScanRepository(appDb);
    const repo = "rome-os/rome";

    expect(repository.upsertPRReviewSettings(repo, {})).toMatchObject({ autoReviewMaxPerPr: 5 });

    repository.upsertPRReviewSettings(repo, { autoReviewMaxPerPr: 3 });
    expect(createScanRepository(appDb).getPRReviewSettings(repo)).toMatchObject({ autoReviewMaxPerPr: 3 });

    // An unrelated partial update must not reset the cap.
    repository.upsertPRReviewSettings(repo, { triggerOnPush: false });
    expect(repository.getPRReviewSettings(repo)).toMatchObject({ autoReviewMaxPerPr: 3 });
  });

  it("floors, clamps, and treats non-positive input as no limit", () => {
    const repository = createScanRepository(appDb);
    const repo = "rome-os/rome";

    repository.upsertPRReviewSettings(repo, { autoReviewMaxPerPr: 4.7 });
    expect(repository.getPRReviewSettings(repo)).toMatchObject({ autoReviewMaxPerPr: 4 });

    repository.upsertPRReviewSettings(repo, { autoReviewMaxPerPr: 9999 });
    expect(repository.getPRReviewSettings(repo)).toMatchObject({ autoReviewMaxPerPr: 100 });

    repository.upsertPRReviewSettings(repo, { autoReviewMaxPerPr: -1 });
    expect(repository.getPRReviewSettings(repo)).toMatchObject({ autoReviewMaxPerPr: 0 });
  });

  it("counts only completed reviews toward the cap", () => {
    const repository = createScanRepository(appDb);
    const repo = "rome-os/rome";

    const completed = repository.createQueuedPRReview({ repo, prNumber: 440, prUrl: null, prTitle: null, prAuthor: null, headSha: "aaa" });
    repository.completePRReview(completed.id, "looks good", null);
    const failed = repository.createQueuedPRReview({ repo, prNumber: 440, prUrl: null, prTitle: null, prAuthor: null, headSha: "bbb" });
    repository.failPRReview(failed.id, "boom");
    const skipped = repository.createQueuedPRReview({ repo, prNumber: 440, prUrl: null, prTitle: null, prAuthor: null, headSha: "ccc" });
    repository.skipPRReview(skipped.id, "limit reached");
    const otherPr = repository.createQueuedPRReview({ repo, prNumber: 441, prUrl: null, prTitle: null, prAuthor: null, headSha: "ddd" });
    repository.completePRReview(otherPr.id, "fine", null);

    expect(repository.countCompletedPRReviews(repo, 440)).toBe(1);
    expect(repository.countCompletedPRReviews(repo, 441)).toBe(1);
    expect(repository.countCompletedPRReviews("other/repo", 440)).toBe(0);

    expect(repository.hasSkippedPRReviewForCommit(repo, 440, "ccc")).toBe(true);
    expect(repository.hasSkippedPRReviewForCommit(repo, 440, "aaa")).toBe(false);
    expect(repository.hasSkippedPRReviewForCommit(repo, 440, null)).toBe(false);
  });
});
