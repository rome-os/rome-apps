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

  it("offers exactly two opt-in built-ins and only permits toggles", async () => {
    const handler = createApiHandler(ctx);
    const list = async (repo = "o/r") => (await (await request(handler, "GET", "review-lenses", undefined, repo)).json()).lenses;
    expect((await list()).map((l: any) => [l.id, l.enabled])).toEqual([
      ["design-alternatives", false], ["security", false],
    ]);
    expect((await request(handler, "PATCH", "review-lenses/security", { enabled: true })).status).toBe(200);
    expect((await list("O/R"))[1].enabled).toBe(true);
    expect((await list("other/repo"))[1].enabled).toBe(false);
    expect((await request(handler, "PATCH", "review-lenses/security", { enabled: false })).status).toBe(200);
    expect((await list())[1].enabled).toBe(false);
    expect((await request(handler, "PATCH", "review-lenses/custom", { enabled: true })).status).toBe(404);
    expect((await request(handler, "POST", "review-lenses", { name: "Custom", instructions: "Audit" })).status).toBe(405);
    expect((await request(handler, "DELETE", "review-lenses/security")).status).toBe(405);
  });

  it.each([{ enabled: "false" }, {}, { enabled: true, name: "Custom" }, { enabled: true, instructions: "Override" }])("rejects non-toggle configuration", async (body) => {
    expect((await request(createApiHandler(ctx), "PATCH", "review-lenses/security", body)).status).toBe(400);
  });

  it("requires a repo and guardian access", async () => {
    const handler = createApiHandler(ctx);
    expect((await request(handler, "GET", "review-lenses", undefined, "")).status).toBe(400);
    expect((await request(handler, "GET", "review-lenses", undefined, "o/r", "visitor")).status).toBe(401);
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
