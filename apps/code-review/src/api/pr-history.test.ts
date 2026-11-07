import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiHandler } from "./index.js";
import { createScanRepository } from "../db/repositories/repo.js";

const mocks = vi.hoisted(() => ({ gh: vi.fn() }));
vi.mock("child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.gh }) };
});

describe("PR history access boundary", () => {
  let sqlite: Database.Database;
  let ctx: any;
  let db: ReturnType<typeof createScanRepository>;
  let handler: ReturnType<typeof createApiHandler>;
  beforeEach(() => {
    mocks.gh.mockReset().mockResolvedValue({ stdout: "public\n" });
    sqlite = new Database(":memory:");
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
      for (const sql of readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint")) {
        if (sql.trim()) sqlite.exec(sql);
      }
    }
    ctx = {
      app: { id: "code-review", version: "public-history-tests" },
      db: { connection: drizzle(sqlite), tablePrefix: "repo_guardian" },
      runAction: vi.fn(),
    };
    db = createScanRepository(ctx.db);
    handler = createApiHandler(ctx);
    // Guardian reconciliation is unrelated to these reads. Public requests must
    // not call it at all, including when constructing the handler.
    vi.spyOn(handler as any, "_ensureRoutinesIfNeeded").mockResolvedValue(undefined);
  });
  afterEach(() => sqlite.close());

  const request = (kind = "anonymous", method = "GET", path = "pr-history", query = { repo: "Rome-OS/Rome", number: "1804" }) =>
    handler.handle({ method, path: path.split("/"), query: new URLSearchParams(query), caller: { kind },
      headers: { "x-rome-user-id": "guardian", "x-rome-visitor-email": "owner@example.com" } } as any);

  function seed() {
    const review = db.createQueuedPRReview({ repo: "rome-os/rome", prNumber: 1804 });
    db.completePRReview(review.id, "**Verdict:** APPROVE — secret requester notes", "https://github.com/rome-os/rome/pull/1804#pullrequestreview-123");
    sqlite.prepare("UPDATE repo_guardian__pr_reviews SET lens_instructions = ?, stage_history = ?, rome_session = ? WHERE id = ?")
      .run("secret prompt", "secret error /home/rome token", '{"_romeSessionId":"secret-session"}', review.id);
    const task = db.createMentionTask({ repo: "ROME-OS/ROME", surface: "pr", number: 1804, intent: "update-memory", commentBody: "secret comment", actorLogin: "private-requester" });
    db.completeMentionTask(task.id, { url: "https://github.com/rome-os/rome/pull/1804#issuecomment-456", body: "secret project memory", error: "secret token" });
    db.createQueuedPRReview({ repo: "private/repo", prNumber: 1804 });
    db.createQueuedPRReview({ repo: "rome-os/rome", prNumber: 1805 });
    db.createMentionTask({ repo: "rome-os/rome", surface: "issue", number: 1804, intent: "general" });
    return { review, task };
  }

  it.each(["anonymous", "visitor"])("allows %s only a metadata projection for a verified public repo (case insensitive)", async kind => {
    const { review, task } = seed();
    const res = await request(kind);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.reviews).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ reviewComment: "Verdict: APPROVE", lensInstructions: null, romeSession: null, stageHistory: null });
    expect(body.tasks[0].resultRef).toBe('{"url":"https://github.com/Rome-OS/Rome/pull/1804#issuecomment-456"}');
    const encoded = JSON.stringify(body);
    for (const privateValue of ["secret", "private-requester", review.id, task.id, "private/repo", "1805"]) expect(encoded).not.toContain(privateValue);
    expect(mocks.gh).toHaveBeenCalledWith("gh", ["api", "repos/Rome-OS/Rome", "--jq", ".visibility"], expect.anything());
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect((handler as any)._ensureRoutinesIfNeeded).not.toHaveBeenCalled();
  });

  it.each(["private", "internal", "", "unknown"])("fails closed for %s without touching the database", async visibility => {
    mocks.gh.mockResolvedValue({ stdout: visibility });
    ctx.db = null;
    const res = await request();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("fails closed on GitHub errors and refreshes previously cached public visibility", async () => {
    expect((await request()).status).toBe(200);
    mocks.gh.mockResolvedValueOnce({ stdout: "private" });
    expect((await request()).status).toBe(404);
    mocks.gh.mockRejectedValueOnce(new Error("secret credential error"));
    const res = await request();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("secret");
    expect(mocks.gh).toHaveBeenCalledTimes(3);
  });

  it("preserves full guardian access without a GitHub visibility lookup", async () => {
    const { review, task } = seed();
    mocks.gh.mockRejectedValue(new Error("offline"));
    const body = await (await request("guardian")).json();
    expect(body.reviews[0]).toMatchObject({ id: review.id, lensInstructions: "secret prompt", reviewComment: expect.stringContaining("secret requester") });
    expect(body.tasks[0]).toMatchObject({ id: task.id, commentBody: "secret comment" });
    expect(mocks.gh).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1x", "1.2", "9007199254740992", ""])("rejects invalid PR number %s before GitHub", async number => {
    expect((await request("anonymous", "GET", "pr-history", { repo: "o/r", number })).status).toBe(400);
    expect(mocks.gh).not.toHaveBeenCalled();
  });

  it("rejects malformed repository slugs before GitHub", async () => {
    expect((await request("anonymous", "GET", "pr-history", { repo: "o/r/../private", number: "1" })).status).toBe(400);
    expect(mocks.gh).not.toHaveBeenCalled();
  });

  it.each(["anonymous", "visitor"])("structurally denies all other routes and methods to %s", async kind => {
    ctx.db = null;
    for (const [method, path] of [
      ["GET", "dashboard"], ["GET", "repositories"], ["POST", "repositories"], ["DELETE", "repositories/id"],
      ["GET", "activity"], ["GET", "gh-auth-status"], ["GET", "github-users/owner"],
      ["GET", "pr-review-settings"], ["POST", "pr-review-settings"], ["GET", "project-memory"], ["POST", "project-memory"],
      ["GET", "pr-reviews"], ["GET", "pr-reviews/id"], ["POST", "pr-reviews"], ["POST", "pr-reviews/id/cancel"],
      ["GET", "mention-tasks/id"], ["POST", "connection/repair"], ["GET", "future-route"],
      ["POST", "pr-history"], ["DELETE", "pr-history"], ["HEAD", "pr-history"], ["GET", "pr-history/extra"],
    ]) expect((await request(kind, method, path)).status, `${method} ${path}`).toBe(403);
    expect(mocks.gh).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
