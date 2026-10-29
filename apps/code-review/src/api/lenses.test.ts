import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiHandler } from "./index.js";
import { createScanRepository } from "../db/repositories/repo.js";

describe("reviewer lens API", () => {
  let sqlite: Database.Database;
  let ctx: any;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
      for (const statement of readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.exec(statement);
      }
    }
    ctx = {
      app: { id: "code-review", version: "lens-api-tests" },
      db: { connection: drizzle(sqlite), tablePrefix: "repo_guardian" },
      runAction: vi.fn().mockResolvedValue({ executionId: "accepted" }),
    };
  });
  afterEach(() => sqlite.close());

  function request(handler: ReturnType<typeof createApiHandler>, method: string, path: string, body?: unknown, repo = "o/r", kind = "guardian") {
    return handler.handle({
      method, path: path.split("/"), query: new URLSearchParams({ repo }), caller: { kind },
      body: body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)),
      headers: {},
    } as any);
  }

  it.each([true, false])("rejects retired reviewer configuration routes without changing opt-ins (%s)", async (enabled) => {
    const db = createScanRepository(ctx.db);
    db.setReviewLensEnabled("o/r", "security", !enabled);
    const handler = createApiHandler(ctx);
    expect((await request(handler, "PATCH", "review-lenses/security", { enabled })).status).toBe(404);
    expect((await request(handler, "GET", "review-lenses")).status).toBe(404);
    expect(db.listReviewLenses("o/r").find(l => l.id === "security")?.enabled).toBe(!enabled);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it.each([{ repo: "o/r", prNumber: 7 }, { prUrl: "https://github.com/o/r/pull/7" }])("fans out dashboard manual triggers and keeps reviewId pointing at main", async (payload) => {
    const db = createScanRepository(ctx.db);
    db.setReviewLensEnabled("o/r", "security", true);
    const res = await request(createApiHandler(ctx), "POST", "pr-reviews", payload);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.reviewIds).toHaveLength(2);
    expect(db.getPRReview(data.reviewId)?.lensId).toBeNull();
    expect(db.getPRReview(data.reviewIds[1])).toMatchObject({ lensName: "Security", lensInstructions: expect.stringContaining("concrete attack path") });
    expect(ctx.runAction).toHaveBeenCalledTimes(2);
    expect(db.listPRReviews()).toHaveLength(2);
  });
});
