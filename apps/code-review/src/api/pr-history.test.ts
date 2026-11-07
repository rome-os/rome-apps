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
  let now = Date.now();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now += 120_000);
    mocks.gh.mockReset().mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes(".visibility")) return Promise.resolve({ stdout: "public\n" });
      if (args[1].includes("/reviews?")) return Promise.resolve({ stdout: JSON.stringify([
        { id: 123, html_url: "https://github.com/rome-os/rome/pull/1804#pullrequestreview-123", state: "COMMENTED", body: "**Verdict:** APPROVE — published summary" },
      ]) });
      if (args[1].includes("/pulls/")) return Promise.resolve({ stdout: JSON.stringify([
        { pull_request_review_id: 123, html_url: "https://github.com/rome-os/rome/pull/1804#discussion_r789", path: "src/api.ts", line: 12, body: "**[P1]** Published finding" },
      ]) });
      return Promise.resolve({ stdout: JSON.stringify([
        { html_url: "https://github.com/rome-os/rome/pull/1804#issuecomment-456", body: "Published memory-update acknowledgement (not project memory)" },
      ]) });
    });
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
  afterEach(() => { sqlite.close(); vi.useRealTimers(); });

  const request = (kind = "anonymous", method = "GET", path = "pr-history", query = { repo: "Rome-OS/Rome", number: "1804" }) =>
    handler.handle({ method, path: path ? path.split("/") : [], query: new URLSearchParams(query), caller: { kind },
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

  it.each(["anonymous", "visitor"])("allows %s only published content for a verified public repo (case insensitive)", async kind => {
    const { review, task } = seed();
    const res = await request(kind);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.reviews).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ reviewComment: "**Verdict:** APPROVE — published summary", lensInstructions: null, romeSession: null, stageHistory: null });
    expect(body.reviews[0].findings).toEqual([{ path: "src/api.ts", line: 12, body: "**[P1]** Published finding", url: "https://github.com/Rome-OS/Rome/pull/1804#discussion_r789" }]);
    expect(JSON.parse(body.tasks[0].resultRef)).toEqual({ url: "https://github.com/Rome-OS/Rome/pull/1804#issuecomment-456", body: "Published memory-update acknowledgement (not project memory)" });
    const encoded = JSON.stringify(body);
    for (const privateValue of ["secret", "private-requester", review.id, task.id, "private/repo", "1805"]) expect(encoded).not.toContain(privateValue);
    expect(mocks.gh).toHaveBeenCalledWith("gh", ["api", "repos/Rome-OS/Rome", "--jq", ".visibility"], expect.anything());
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect((handler as any)._ensureRoutinesIfNeeded).not.toHaveBeenCalled();
  });

  it("never falls back to stored text when published content cannot be fetched", async () => {
    seed();
    mocks.gh.mockResolvedValueOnce({ stdout: "public" }).mockRejectedValueOnce(new Error("secret error"));
    const res = await request();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "history_unavailable" });
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

  it("keeps internal database/module errors out of the public response", async () => {
    ctx.db = null;
    const res = await request();
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "history_unavailable" });
  });

  it("rejects excess concurrent lookups before starting another GitHub subprocess", async () => {
    const pending: ((value: { stdout: string }) => void)[] = [];
    mocks.gh.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const a = request();
    const b = request();
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(mocks.gh).toHaveBeenCalledTimes(2);
    for (const resolve of pending) resolve({ stdout: "public" });
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    mocks.gh.mockResolvedValue({ stdout: "public" });
    expect((await request()).status).toBe(200);
  });

  it("applies the shared rate budget to content pages too, without partial results", async () => {
    for (let i = 0; i < 27; i++) expect((await request()).status).toBe(200);
    seed();
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "too_many_requests" });
    expect(mocks.gh).toHaveBeenCalledTimes(30);
    // Minute rollover restores the whole read, not just visibility permission.
    vi.setSystemTime(now += 60_000);
    expect((await request()).status).toBe(200);
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
    // Inventory of every handler branch, including parameterized routes, root,
    // retired/unknown routes and likely webhook paths. Every method is denied:
    // adding a method or a future route cannot accidentally make it public.
    const privatePaths = [
      "", "dashboard", "repositories", "repositories/id", "activity", "gh-auth-status", "github-users/owner",
      "pr-review-settings", "pr-review-settings/rome-os%2Frome", "project-memory",
      "pr-reviews", "pr-reviews/id", "pr-reviews/id/cancel", "mention-tasks", "mention-tasks/id",
      "connection/repair", "review-lenses", "webhook", "webhook/github", "pr-webhook", "future-route",
      "pr-history/extra", "pr-history%2Fextra", "pr-history/../dashboard", "PR-history",
    ];
    for (const path of privatePaths) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        const res = await request(kind, method, path);
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden" });
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect((await request(kind, method, "pr-history")).status, `${method} pr-history`).toBe(403);
    }
    expect(mocks.gh).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
