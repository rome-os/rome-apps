import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiHandler } from "./index.js";
import { createScanRepository } from "../db/repositories/repo.js";
import { decideAgentTrigger } from "../actions/pr-webhook/agent-decision.js";
import { NEW_REPO_AGENT_SETTINGS, NEW_REPO_REVIEWERS } from "../lib/agent-settings.js";
import { CREATE_ROUTINE_ACTION, DELETE_ROUTINE_ACTION, GITHUB_EVENTS, SEARCH_ROUTINE_ACTION, SUBSCRIBE_ACTION, UNSUBSCRIBE_ACTION } from "../utils/github-events.js";

describe("per-agent settings API", () => {
  let sqlite: Database.Database;
  let ctx: any;
  let handler: ReturnType<typeof createApiHandler>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
      for (const sql of readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint")) if (sql.trim()) sqlite.exec(sql);
    }
    ctx = { app: { id: "code-review", version: "0.38.0" }, db: { connection: drizzle(sqlite), tablePrefix: "repo_guardian" },
      runAction: vi.fn().mockImplementation(async (name: string) => name === SUBSCRIBE_ACTION
        ? { status: "ok", data: { hookId: "hook-1" } } : { status: "ok", data: {} }) };
    handler = createApiHandler(ctx);
    vi.spyOn(handler as any, "_readGitHubLogin").mockResolvedValue("bot");
    vi.spyOn(handler as any, "_readRoutineStatus").mockResolvedValue({ ready: true });
  });
  afterEach(() => sqlite.close());
  function save(body: unknown) {
    return handler.handle({ method: "POST", path: ["pr-review-settings"], query: new URLSearchParams(), caller: { kind: "guardian" },
      body: new TextEncoder().encode(JSON.stringify(body)), headers: {} } as any);
  }
  function settings() { return createScanRepository(ctx.db).upsertPRReviewSettings("o/r", { autoReviewEnabled: false, triggerOnRequest: false }); }
  it("saves the new-repo defaults (rome-os/rome's setup) for a repo with no settings", async () => {
    const response = await save({ repo: "o/new", autoReviewEnabled: true, triggerOnCreate: true, manualTriggerEnabled: true,
      triggerOnReviewRequest: true, triggerOnMention: true, triggerOnPush: true, triggerAccessMode: "blocklist",
      triggerAllowlist: [], triggerBlocklist: [], mentionTriggerPhrase: "PTAL", summaryTriggerPhrase: "summary",
      customRules: null, agentSettings: NEW_REPO_AGENT_SETTINGS, reviewerEnabled: NEW_REPO_REVIEWERS });
    expect(response.status).toBe(200);
    expect(createScanRepository(ctx.db).getPRReviewSettings("o/new")).toMatchObject({ autoReviewEnabled: true,
      triggerAccessMode: "blocklist", triggerBlocklist: [], githubWebhookId: "hook-1", agentSettings: NEW_REPO_AGENT_SETTINGS });
    expect(createScanRepository(ctx.db).listReviewLenses("o/new").every(l => l.enabled)).toBe(true);
  });
  it("validates before touching webhook subscriptions or stored settings", async () => {
    const original = settings();
    const invalid = [ { mentionTriggerPhrase: " " }, { summaryTriggerPhrase: "pTaL" }, { mentionTriggerPhrase: 3 },
      { agentSettings: {} }, { agentSettings: { ...original.agentSettings, assistant: { enabled: false, onMention: true, phrase: "summary" } } },
      { reviewerEnabled: { security: true } } ];
    for (const bad of invalid) {
      expect((await save({ repo: "o/r", ...bad })).status).toBe(400);
      expect(createScanRepository(ctx.db).getPRReviewSettings("o/r")).toEqual(original);
    }
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
  it.each(["security", "design-alternatives"])("wires first-enabled and unwires last-disabled %s through project settings", async (id) => {
    const s = settings(); s.agentSettings.reviewEnabled = false;
    s.agentSettings.security.onPush = true; s.agentSettings.designAlternatives.onPush = true;
    const db = createScanRepository(ctx.db);
    db.upsertPRReviewSettings("o/r", { agentSettings: s.agentSettings });
    const routines = new Map<string, any>();
    ctx.runAction.mockImplementation(async (name: string, args: any) => {
      if (name === SUBSCRIBE_ACTION) return { status: "ok", data: { hookId: "hook-1" } };
      if (name === CREATE_ROUTINE_ACTION) routines.set(args.key, { id: args.key, ...args });
      if (name === SEARCH_ROUTINE_ACTION) return { status: "ok", data: { matches: [...routines.values()].filter(r => r.actionName === args.query) } };
      if (name === DELETE_ROUTINE_ACTION) routines.delete(args.routineId);
      return { status: "ok", data: {} };
    });
    const reviewerEnabled = { security: id === "security", "design-alternatives": id === "design-alternatives" };
    const response = await save({ repo: "o/r", reviewerEnabled });
    expect(response.status).toBe(200);
    expect((await response.json()).settings).toMatchObject({ autoReviewEnabled: false, triggerOnRequest: false,
      githubWebhookId: "hook-1", triggerWiringHealthy: true, agentSettings: s.agentSettings,
      reviewers: [{ id: "design-alternatives", enabled: reviewerEnabled["design-alternatives"] }, { id: "security", enabled: reviewerEnabled.security }] });
    expect(ctx.runAction).toHaveBeenCalledWith(SUBSCRIBE_ACTION, { repo: "o/r", events: [...GITHUB_EVENTS] });
    expect(routines.size).toBe(GITHUB_EVENTS.length);
    expect(ctx.runAction).not.toHaveBeenCalledWith(UNSUBSCRIBE_ACTION, expect.anything());

    ctx.runAction.mockClear();
    const disabled = await save({ repo: "o/r", reviewerEnabled: { security: false, "design-alternatives": false } });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).settings).toMatchObject({ githubWebhookId: null, triggerWiringHealthy: false });
    expect(db.listReviewLenses("o/r").every(l => !l.enabled)).toBe(true);
    expect(db.getPRReviewSettings("o/r")?.agentSettings).toEqual(s.agentSettings); // preferences survive
    expect(ctx.runAction).toHaveBeenCalledWith(UNSUBSCRIBE_ACTION, { repo: "o/r" });
    expect(ctx.runAction).not.toHaveBeenCalledWith(SUBSCRIBE_ACTION, expect.anything());
    expect(ctx.runAction.mock.calls.filter(([name]: [string]) => name === DELETE_ROUTINE_ACTION)).toHaveLength(GITHUB_EVENTS.length);
    expect(routines.size).toBe(0);
  });
  it.each([false, true])("uses post-update legacy defaults but preserves explicit agent config (stored=%s)", async (stored) => {
    const db = createScanRepository(ctx.db);
    const original = db.upsertPRReviewSettings("o/r", {
      autoReviewEnabled: true, triggerOnRequest: true, githubWebhookId: "existing-hook",
    });
    db.setReviewLensEnabled("o/r", "security", true);
    if (stored) db.upsertPRReviewSettings("o/r", { agentSettings: original.agentSettings });
    const response = await save({ repo: "o/r", autoReviewEnabled: false, manualTriggerEnabled: false });
    expect(response.status).toBe(200);
    const reloaded = db.getPRReviewSettings("o/r")!;
    expect(reloaded).toMatchObject({ autoReviewEnabled: false, triggerOnRequest: false,
      githubWebhookId: stored ? "existing-hook" : null });
    expect(reloaded.agentSettings.summary.enabled).toBe(stored);
    expect(reloaded.agentSettings.security.onPush).toBe(stored);
    expect(sqlite.prepare("SELECT agent_settings FROM repo_guardian__pr_review_settings").get()).toEqual({
      agent_settings: stored ? JSON.stringify(original.agentSettings) : null,
    });
    if (stored) {
      expect(ctx.runAction).toHaveBeenCalledWith(CREATE_ROUTINE_ACTION, expect.anything());
      expect(ctx.runAction).not.toHaveBeenCalledWith(UNSUBSCRIBE_ACTION, expect.anything());
    } else {
      expect(ctx.runAction).toHaveBeenCalledWith(UNSUBSCRIBE_ACTION, { repo: "o/r" });
      expect(ctx.runAction).not.toHaveBeenCalledWith(SUBSCRIBE_ACTION, expect.anything());
      expect(ctx.runAction).not.toHaveBeenCalledWith(CREATE_ROUTINE_ACTION, expect.anything());
    }
  });
  it("keeps Summary wired when Code Review is off, and removes wiring only after all agents are off", async () => {
    const s = settings(); s.agentSettings.reviewEnabled = false; s.agentSettings.summary.enabled = true;
    expect((await save({ repo: "o/r", agentSettings: s.agentSettings })).status).toBe(200);
    expect(ctx.runAction).toHaveBeenCalledWith(SUBSCRIBE_ACTION, expect.anything());
    ctx.runAction.mockClear();
    s.agentSettings.summary.enabled = false;
    expect((await save({ repo: "o/r", agentSettings: s.agentSettings })).status).toBe(200);
    expect(ctx.runAction).toHaveBeenCalledWith(UNSUBSCRIBE_ACTION, { repo: "o/r" });
  });
  it("preserves automatic triggers while the last agent is disabled, then resumes them on re-enable", async () => {
    const db = createScanRepository(ctx.db);
    const original = db.upsertPRReviewSettings("o/r", {
      autoReviewEnabled: true, triggerOnCreate: true, triggerOnPush: true,
      triggerOnRequest: true, triggerOnReviewRequest: false, triggerOnMention: true,
      githubWebhookId: "existing-hook",
    });
    const agents = { ...original.agentSettings, summary: { enabled: false, onMention: true } };
    const route = (action: string) => decideAgentTrigger({
      githubEvent: "pull_request", currentGitHubLogin: "bot", lenses: [],
      settings: db.getPRReviewSettings("o/r"),
      payload: { action, repository: { full_name: "o/r" }, sender: { login: "alice" },
        pull_request: { number: 3, user: { login: "alice" } } },
    });
    expect((await save({ repo: "o/r", agentSettings: { ...agents, reviewEnabled: false } })).status).toBe(200);
    const disabled = db.getPRReviewSettings("o/r")!;
    expect(disabled).toMatchObject({
      autoReviewEnabled: true, triggerOnCreate: true, triggerOnPush: true,
      triggerOnRequest: true, triggerOnReviewRequest: false, triggerOnMention: true,
      githubWebhookId: null, webhookChannelUrl: null,
    });
    expect(ctx.runAction).toHaveBeenCalledWith(UNSUBSCRIBE_ACTION, { repo: "o/r" });
    expect(ctx.runAction).not.toHaveBeenCalledWith(SUBSCRIBE_ACTION, expect.anything());
    for (const action of ["opened", "synchronize"]) expect(route(action).kind).toBe("skip");

    ctx.runAction.mockClear();
    expect((await save({ repo: "o/r", agentSettings: { ...disabled.agentSettings, reviewEnabled: true } })).status).toBe(200);
    expect(ctx.runAction).toHaveBeenCalledWith(SUBSCRIBE_ACTION, expect.objectContaining({ repo: "o/r" }));
    expect(db.getPRReviewSettings("o/r")).toMatchObject({
      autoReviewEnabled: true, triggerOnCreate: true, triggerOnPush: true,
      triggerOnRequest: true, triggerOnReviewRequest: false, triggerOnMention: true,
    });
    for (const action of ["opened", "synchronize"]) {
      expect(route(action)).toMatchObject({ kind: "trigger", reviewAgentIds: ["review"] });
    }
  });
});
