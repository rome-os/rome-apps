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

  it("creates, edits, toggles and deletes only within the selected repo", async () => {
    const handler = createApiHandler(ctx);
    let res = await request(handler, "POST", "review-lenses", { name: "Adversarial", instructions: "Find evidenced bugs" });
    expect(res.status).toBe(201);
    const { lens } = await res.json();
    expect(lens).toMatchObject({ repo: "o/r", enabled: true, position: 0 });
    res = await request(handler, "PATCH", `review-lenses/${lens.id}`, { enabled: false, name: "Skeptical" });
    expect(res.status).toBe(200);
    expect((await res.json()).lens).toMatchObject({ enabled: false, name: "Skeptical", instructions: "Find evidenced bugs" });
    expect((await request(handler, "DELETE", `review-lenses/${lens.id}`, undefined, "other/repo")).status).toBe(404);
    const list = await request(handler, "GET", "review-lenses");
    expect((await list.json()).lenses).toHaveLength(1);
    expect((await request(handler, "DELETE", `review-lenses/${lens.id}`)).status).toBe(200);
    expect((await (await request(handler, "GET", "review-lenses")).json()).lenses).toEqual([]);
  });

  it.each([
    { name: "", instructions: "Audit" },
    { name: "A", instructions: "" },
    { name: "A", instructions: "Audit", enabled: "false" },
    { name: "A", instructions: "Audit", position: -1 },
    { name: "A", instructions: "Audit", position: 1.5 },
    { name: "a".repeat(101), instructions: "Audit" },
    { name: "A", instructions: "a".repeat(20001) },
  ])("rejects invalid configuration", async (body) => {
    expect((await request(createApiHandler(ctx), "POST", "review-lenses", body)).status).toBe(400);
  });

  it("requires a repo and guardian access", async () => {
    const handler = createApiHandler(ctx);
    expect((await request(handler, "GET", "review-lenses", undefined, "")).status).toBe(400);
    expect((await request(handler, "GET", "review-lenses", undefined, "o/r", "visitor")).status).toBe(401);
  });

  it.each([{ repo: "o/r", prNumber: 7 }, { prUrl: "https://github.com/o/r/pull/7" }])("fans out dashboard manual triggers and keeps reviewId pointing at main", async (payload) => {
    const db = createScanRepository(ctx.db);
    db.createReviewLens("o/r", { name: "Adversarial", instructions: "Original" });
    db.createReviewLens("o/r", { name: "Off", instructions: "Skip", enabled: false });
    const res = await request(createApiHandler(ctx), "POST", "pr-reviews", payload);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.reviewIds).toHaveLength(2);
    expect(db.getPRReview(data.reviewId)?.lensId).toBeNull();
    expect(db.getPRReview(data.reviewIds[1])).toMatchObject({ lensName: "Adversarial", lensInstructions: "Original" });
    expect(ctx.runAction).toHaveBeenCalledTimes(2);
    expect(db.listPRReviews()).toHaveLength(2);
  });
});
