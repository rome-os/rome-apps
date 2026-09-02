import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createAppLogger } from "@rome-os/app-runtime";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ScanRepository } from "../db/repositories/repo.js";
import { isTriggerAccessMode } from "../lib/trigger-access.js";
import { sanitizeCliError } from "../utils/cli-errors.js";
import {
  GITHUB_EVENTS,
  HANDLER_ACTION,
  SUBSCRIBE_ACTION,
  UNSUBSCRIBE_ACTION,
  ensureGithubRoutines,
  removeGithubRoutines,
  type GithubRoutineStatus,
  type RunAction,
} from "../utils/github-events.js";

const log = createAppLogger("code-review_api");
const execFileAsync = promisify(execFile);

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readJson(request: RomeAppApiRequest): any {
  try {
    if (!request.body || request.body.length === 0) return {};
    const text = new TextDecoder().decode(request.body);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeGitHubLogin(login: unknown): string | null {
  if (typeof login !== "string") return null;
  const normalized = login.trim().replace(/^@+/, "").toLowerCase();
  return normalized ? normalized : null;
}

function sanitizeGitHubLoginList(value: unknown, guardianLogin: string | null): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const guardian = normalizeGitHubLogin(guardianLogin);
  const seen = new Set<string>();
  const logins: string[] = [];
  for (const item of rawItems) {
    const login = normalizeGitHubLogin(item);
    if (!login || login === guardian || seen.has(login)) continue;
    seen.add(login);
    logins.push(login);
  }
  return logins;
}

function isValidGitHubLogin(login: string): boolean {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(login);
}

/** A normalized activity item spanning PR reviews and new-flow mention tasks. */
interface ActivityItem {
  kind: "review" | "mention";
  /** Filter type: review | question | memory | code-task. */
  type: string;
  /** Human-readable tag shown on the item. */
  tag: string;
  id: string;
  repo: string;
  surface: "pr" | "issue";
  number: number;
  title: string;
  intent: string | null;
  status: string;
  actor: string | null;
  /** GitHub link to the PR/issue. */
  url: string;
  /** GitHub link to the landed result (review / reply / PR), if any. */
  resultUrl: string | null;
  hasSession: boolean;
  createdAt: string;
  completedAt: string | null;
}

const INTENT_TO_TYPE: Record<string, { type: string; tag: string }> = {
  "update-memory": { type: "memory", tag: "Memory update" },
  "code-task": { type: "code-task", tag: "Code task" },
  general: { type: "question", tag: "Question" },
};

function resultRefUrl(resultRef: string | null): string | null {
  if (!resultRef) return null;
  try {
    const r = JSON.parse(resultRef) as Record<string, unknown>;
    return (r.prUrl as string) || (r.url as string) || (r.replyUrl as string) || null;
  } catch {
    return null;
  }
}

/**
 * Build the merged activity feed from both tables (recent-capped), newest first.
 * Reviews and mention tasks are normalized to a common shape so the UI renders
 * one list with per-item type tags and a single filter.
 */
function buildActivityItems(repo: ScanRepository): ActivityItem[] {
  const reviews = repo.listPRReviews(200).map<ActivityItem>((r) => ({
    kind: "review",
    type: "review",
    tag: "Review",
    id: r.id,
    repo: r.repo,
    surface: "pr",
    number: r.prNumber,
    title: r.prTitle,
    intent: null,
    status: r.status,
    actor: r.prAuthor,
    url: r.prUrl,
    resultUrl: r.githubCommentUrl,
    hasSession: !!r.romeSession,
    createdAt: r.startedAt,
    completedAt: r.completedAt,
  }));

  const tasks = repo.listMentionTasks(200).map<ActivityItem>((t) => {
    const meta = INTENT_TO_TYPE[t.intent] ?? { type: t.intent, tag: t.intent };
    const body = (t.commentBody || "").replace(/\s+/g, " ").trim();
    const title = body ? (body.length > 120 ? `${body.slice(0, 120)}…` : body) : meta.tag;
    const url = t.surface === "pr"
      ? `https://github.com/${t.repo}/pull/${t.number}`
      : `https://github.com/${t.repo}/issues/${t.number}`;
    return {
      kind: "mention",
      type: meta.type,
      tag: meta.tag,
      id: t.id,
      repo: t.repo,
      surface: t.surface,
      number: t.number,
      title,
      intent: t.intent,
      status: t.status,
      actor: t.actorLogin,
      url,
      resultUrl: resultRefUrl(t.resultRef),
      hasSession: !!t.romeSession,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    };
  });

  return [...reviews, ...tasks].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });
}

/** The activity filter types shown as tabs, plus the "all" total. */
type ActivityCounts = { all: number; review: number; question: number; memory: number; "code-task": number };

/** Tally activity items by filter type so the dashboard tabs can show counts. */
function computeActivityCounts(items: ActivityItem[]): ActivityCounts {
  const counts: ActivityCounts = { all: items.length, review: 0, question: 0, memory: 0, "code-task": 0 };
  for (const item of items) {
    if (item.type === "review" || item.type === "question" || item.type === "memory" || item.type === "code-task") {
      counts[item.type] += 1;
    }
  }
  return counts;
}

async function loadScanRepository(ctx: RomeAppContext): Promise<ScanRepository> {
  const modUrl = new URL("../db/repositories/repo.js", import.meta.url);
  const mod = await import(`${modUrl.href}?v=${Date.now()}`);
  return mod.createScanRepository(ctx.db);
}

// ---------------------------------------------------------------------------
// API Handler
// ---------------------------------------------------------------------------
//
// GitHub PR events reach this app via Rome's event bus, NOT smee.io:
//
//   GitHub repo webhook  (registered by connector_github_subscribe)
//     -> /api/app-api/connector/webhook  (HMAC verify + delivery dedup)
//     -> publish_event  provider:event:github.<event>
//     -> routine (event-bus trigger, created by ensureGithubRoutines)
//     -> code-review_pr-webhook  (per-repo filtering)
//     -> code-review_pr-review
//
// This handler's job for webhooks is only lifecycle: when a repo's auto-review
// is toggled it (un)subscribes the GitHub webhook and ensures/removes the
// shared event-bus routines. The actual event dispatch lives in the
// pr-webhook action.

type GithubUserResult = { login: string; name: string | null; avatarUrl: string | null; htmlUrl: string | null };

/** Cache a successfully-resolved GitHub user for a day; cache a miss briefly. */
const GH_USER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GH_USER_CACHE_MISS_TTL_MS = 5 * 60 * 1000;

class GuardianApiHandler implements RomeAppApiHandler {
  private readonly runAction: RunAction;

  /**
   * Process-lifetime cache of resolved GitHub users. The dashboard resolves the
   * same handful of logins (repo owners + PR authors) on every load; caching
   * here means the `gh api users/<login>` round-trip runs at most once per login
   * per day instead of once per request, which is the server layer of the avatar
   * caching chain (client localStorage + CDN cache are the other two).
   */
  private readonly githubUserCache = new Map<string, { user: GithubUserResult | null; expiresAt: number }>();

  constructor(private readonly ctx: RomeAppContext) {
    this.runAction = (name, args) => this.ctx.runAction(name, args);
    // Self-heal the connection on boot. Beyond re-creating manually deleted
    // routines, this also converges both layers after an app upgrade adds a new
    // GitHub event to GITHUB_EVENTS (e.g. `issues`): it re-subscribes the
    // webhook so GitHub delivers the new event, and creates/enables the matching
    // event-bus routine. Best-effort and fire-and-forget — errors are logged.
    void this._ensureRoutinesIfNeeded();
  }

  /**
   * Best-effort removal of a legacy smee.io GitHub webhook (registered by the
   * old gh-CLI path) when migrating a repo onto the event bus. Never throws —
   * a leftover dead-channel hook is harmless, just clutter.
   */
  private async _removeLegacyWebhook(repoSlug: string, webhookId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoSlug) || !/^\d+$/.test(webhookId)) return;
    try {
      await execFileAsync("gh", ["api", `repos/${repoSlug}/hooks/${webhookId}`, "--method", "DELETE"], {
        encoding: "utf-8",
        timeout: 15000,
      });
      log.info("Removed legacy smee webhook", { repo: repoSlug, webhookId });
    } catch (err) {
      log.warn("Failed to remove legacy smee webhook (continuing)", { repo: repoSlug, webhookId, error: sanitizeCliError(err) });
    }
  }

  private async _ensureRoutinesIfNeeded(): Promise<void> {
    try {
      await this._reconcileConnection(await loadScanRepository(this.ctx));
    } catch (err) {
      log.error("Failed to reconcile connection on init", { error: String(err) });
    }
  }

  /**
   * Idempotently converge the connection for every repo whose webhook-driven
   * triggers are enabled, across BOTH layers that must agree for events to reach
   * the handler:
   *
   *   1. GitHub side — re-subscribe via connector_github_subscribe with the full
   *      GITHUB_EVENTS list. The connector unions the requested events into the
   *      existing relay hook, so a repo wired up before a new event type was
   *      added (e.g. `issues`) starts receiving it without a manual re-add. The
   *      stored githubWebhookId is refreshed if the connector returns a new id.
   *   2. Rome side — ensureGithubRoutines() creates any missing event-bus
   *      routine and re-enables any disabled one.
   *
   * Legacy smee-era repos (non-null webhookChannelUrl) are skipped: their stored
   * hook id is a smee hook, and re-subscribing is handled by the settings-save
   * migration path, not here. Per-repo webhook failures are logged and skipped
   * so one bad repo never blocks healing the rest.
   *
   * Returns a summary the repair endpoint surfaces to the UI. Safe to call from
   * boot self-heal and from an explicit "Repair" action.
   */
  private async _reconcileConnection(
    repo: ScanRepository,
  ): Promise<{ activeRepos: number; hookUpdates: number; routinesEnsured: boolean; webhookErrors: string[] }> {
    const active = repo
      .listAllPRReviewSettings()
      .filter((s) => (s.autoReviewEnabled || s.triggerOnRequest) && !s.webhookChannelUrl);

    let hookUpdates = 0;
    const webhookErrors: string[] = [];

    for (const s of active) {
      try {
        const subRes = await this.ctx.runAction(SUBSCRIBE_ACTION, {
          repo: s.repo,
          events: [...GITHUB_EVENTS],
        });
        if (subRes.status === "error") {
          // Duplicate-hook errors mean events already flow — treat as healthy.
          if (!/already exist|hook already|\b422\b/i.test(subRes.error)) {
            webhookErrors.push(`${s.repo}: ${subRes.error}`);
            log.warn("Reconcile webhook subscribe failed", { repo: s.repo, error: subRes.error });
          }
          continue;
        }
        const newHookId = String((subRes as any)?.data?.hookId ?? "") || null;
        if (newHookId && newHookId !== s.githubWebhookId) {
          repo.upsertPRReviewSettings(s.repo, { githubWebhookId: newHookId, webhookChannelUrl: null });
          hookUpdates += 1;
        }
      } catch (err) {
        webhookErrors.push(`${s.repo}: ${String(err)}`);
        log.warn("Reconcile webhook subscribe threw", { repo: s.repo, error: String(err) });
      }
    }

    // Converge the shared event-bus routines whenever any repo needs them.
    if (active.length > 0) {
      await ensureGithubRoutines(this.runAction);
    }

    return {
      activeRepos: active.length,
      hookUpdates,
      routinesEnsured: active.length > 0,
      webhookErrors,
    };
  }

  private async _readGitHubLogin(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"], {
        encoding: "utf-8",
        timeout: 10000,
      });
      const login = stdout.trim();
      return normalizeGitHubLogin(login);
    } catch (err) {
      log.info("gh auth status check failed", { error: sanitizeCliError(err) });
      return null;
    }
  }

  private async _readGitHubUser(login: string): Promise<GithubUserResult | null> {
    const normalized = normalizeGitHubLogin(login);
    if (!normalized || !isValidGitHubLogin(normalized)) return null;

    const cached = this.githubUserCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const user = await this._fetchGitHubUser(normalized);
    this.githubUserCache.set(normalized, {
      user,
      expiresAt: Date.now() + (user ? GH_USER_CACHE_TTL_MS : GH_USER_CACHE_MISS_TTL_MS),
    });
    return user;
  }

  private async _fetchGitHubUser(normalized: string): Promise<GithubUserResult | null> {
    try {
      const { stdout } = await execFileAsync("gh", ["api", `users/${normalized}`], {
        encoding: "utf-8",
        timeout: 10000,
      });
      const data = JSON.parse(stdout) as Record<string, unknown>;
      const githubLogin = normalizeGitHubLogin(data.login);
      if (!githubLogin) return null;
      return {
        login: githubLogin,
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
        avatarUrl: typeof data.avatar_url === "string" && data.avatar_url ? data.avatar_url : null,
        htmlUrl: typeof data.html_url === "string" && data.html_url ? data.html_url : null,
      };
    } catch (err) {
      log.info("gh user lookup failed", { login: normalized, error: sanitizeCliError(err) });
      return null;
    }
  }

  private async _readRoutineStatus(): Promise<GithubRoutineStatus | null> {
    try {
      // Read-only health check. Do not reconcile from dashboard/settings GET.
      // `listRoutines()` is exposed by the app runtime exactly for app-owned UI
      // to inspect routine state without going through action dispatch.
      const routines = await this.ctx.listRoutines();
      const seen = new Map<string, boolean>();
      for (const routine of routines) {
        if (routine.actionName !== HANDLER_ACTION) continue;
        const event = typeof routine.args?.githubEvent === "string" ? routine.args.githubEvent : "";
        if (!GITHUB_EVENTS.includes(event as any)) continue;
        seen.set(event, routine.enabled === true);
      }
      const required = [...GITHUB_EVENTS];
      const present = required.filter((event) => seen.has(event));
      const enabled = required.filter((event) => seen.get(event) === true);
      const missing = required.filter((event) => !seen.has(event));
      const disabled = required.filter((event) => seen.has(event) && seen.get(event) !== true);
      return {
        ready: missing.length === 0 && disabled.length === 0,
        required,
        present,
        enabled,
        missing,
        disabled,
      };
    } catch (err) {
      log.warn("Failed to read GitHub event routine status", { error: String(err) });
      return null;
    }
  }

  private _augmentSettings<T extends { autoReviewEnabled: boolean; triggerOnRequest: boolean; githubWebhookId: string | null; webhookChannelUrl?: string | null }>(
    settings: T,
    routineStatus: GithubRoutineStatus | null,
    guardianGithubLogin: string | null,
  ): T & { guardianGithubLogin: string | null; webhookConnected: boolean; eventRoutinesReady: boolean | null; eventRoutineStatus: GithubRoutineStatus | null; triggerWiringHealthy: boolean; autoReviewHealthy: boolean } {
    // `webhookChannelUrl` is the legacy smee.io channel. In the event-bus
    // implementation, a repo is webhook-connected only when it has a stored
    // connector/Rome hook id and no legacy smee channel marker.
    const webhookConnected = !!settings.githubWebhookId && !settings.webhookChannelUrl;
    const eventRoutinesReady = routineStatus?.ready ?? null;
    const triggerWiringEnabled = !!settings.autoReviewEnabled || !!settings.triggerOnRequest;
    const triggerWiringHealthy = triggerWiringEnabled && webhookConnected && eventRoutinesReady === true;
    return {
      ...settings,
      guardianGithubLogin,
      webhookConnected,
      eventRoutinesReady,
      eventRoutineStatus: routineStatus,
      triggerWiringHealthy,
      autoReviewHealthy: triggerWiringHealthy,
    };
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");

    // --- GitHub CLI auth status ---
    // Lightweight check the UI calls on load to decide whether to surface a
    // "connect GitHub" guidance prompt. Does not need the DB.
    if (request.method === "GET" && route === "gh-auth-status") {
      const login = await this._readGitHubLogin();
      return json({ loggedIn: Boolean(login), login });
    }

    if (
      request.method === "GET" &&
      request.path.length === 2 &&
      request.path[0] === "github-users"
    ) {
      const login = normalizeGitHubLogin(decodeURIComponent(request.path[1]));
      if (!login || !isValidGitHubLogin(login)) {
        return json({ error: "Invalid GitHub login." }, { status: 400 });
      }
      const user = await this._readGitHubUser(login);
      if (!user) {
        return json({ error: `GitHub user @${login} was not found or GitHub is not connected.` }, { status: 404 });
      }
      // Let the browser HTTP-cache the resolution too (complements the client
      // localStorage cache and the server-side in-memory cache).
      return json({ user }, { headers: { "cache-control": "private, max-age=86400" } });
    }

    const repo = await loadScanRepository(this.ctx);

    // --- App info ---
    if (request.method === "GET" && request.path.length === 0) {
      return json({
        appId: this.ctx.app.id,
        version: this.ctx.app.version,
        status: "ok",
      });
    }

    // --- Repositories CRUD ---
    if (request.method === "GET" && route === "repositories") {
      return json({ repositories: repo.listRepositories() });
    }

    if (request.method === "POST" && route === "repositories") {
      const body = readJson(request);
      const url = (body.url || "").trim();
      const name = (body.name || "").trim();
      if (!url) {
        return json({ error: "url is required" }, { status: 400 });
      }
      const repoName = name || url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git\/?$/, "");
      const added = repo.addRepository(url, repoName);
      return json({ repository: added }, { status: 201 });
    }

    if (
      request.method === "DELETE" &&
      request.path.length === 2 &&
      request.path[0] === "repositories"
    ) {
      repo.removeRepository(request.path[1]);
      return json({ ok: true });
    }

    // --- PR Reviews ---
    if (request.method === "GET" && route === "pr-reviews") {
      const limitParam = parseInt(request.query.get("limit") || "20", 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
      const offsetParam = parseInt(request.query.get("offset") || "0", 10);
      const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
      const reviews = repo.listPRReviews(limit, offset);
      const total = repo.countPRReviews();
      return json({ reviews, total, limit, offset, hasMore: offset + reviews.length < total });
    }

    if (
      request.method === "GET" &&
      request.path.length === 2 &&
      request.path[0] === "pr-reviews"
    ) {
      const review = repo.getPRReview(request.path[1]);
      if (!review) return json({ error: "not_found" }, { status: 404 });
      return json({ review });
    }

    if (
      request.method === "POST" &&
      request.path.length === 3 &&
      request.path[0] === "pr-reviews" &&
      request.path[2] === "cancel"
    ) {
      const reviewId = request.path[1];
      const review = repo.getPRReview(reviewId);
      if (!review) return json({ error: "not_found" }, { status: 404 });

      const cancelledReview = repo.cancelPRReview(reviewId);

      return json({
        ok: true,
        review: cancelledReview ?? repo.getPRReview(reviewId),
      });
    }

    // Trigger a manual PR review
    if (request.method === "POST" && route === "pr-reviews") {
      const body = readJson(request);
      const prUrl = (body.prUrl || "").trim();
      const prNumberInput = body.prNumber;
      const repoInput = (body.repo || "").trim();

      let repoSlug = "";
      let prNumber = 0;

      if (prUrl) {
        const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        if (!match) {
          return json({ error: "Invalid PR URL. Expected format: https://github.com/owner/repo/pull/123" }, { status: 400 });
        }
        repoSlug = match[1];
        prNumber = parseInt(match[2], 10);
      } else if (repoInput && prNumberInput) {
        repoSlug = repoInput.replace(/^https?:\/\/github\.com\//, "").replace(/\.git\/?$/, "");
        prNumber = parseInt(String(prNumberInput), 10);
      } else {
        return json({ error: "Either prUrl or both repo and prNumber are required." }, { status: 400 });
      }

      if (!prNumber || isNaN(prNumber)) {
        return json({ error: "Invalid PR number." }, { status: 400 });
      }

      const queuedReview = repo.createQueuedPRReview({ repo: repoSlug, prNumber });

      await this.ctx.runAction(
        "code-review:code-review_pr-review",
        {
          repo: repoSlug,
          prNumber,
          reviewId: queuedReview.id,
        },
        { detached: true },
      );

      return json({ queued: true, reviewId: queuedReview.id, repo: repoSlug, prNumber }, { status: 202 });
    }

    // --- PR Review Settings ---
    if (
      request.method === "GET" &&
      request.path.length === 2 &&
      request.path[0] === "pr-review-settings"
    ) {
      const repoId = decodeURIComponent(request.path[1]);
      const settings = repo.getPRReviewSettings(repoId);
      const routineStatus = await this._readRoutineStatus();
      const guardianGithubLogin = await this._readGitHubLogin();
      return json({ settings: settings ? this._augmentSettings(settings, routineStatus, guardianGithubLogin) : null });
    }

    if (request.method === "GET" && route === "pr-review-settings") {
      const allSettings = repo.listAllPRReviewSettings();
      const routineStatus = await this._readRoutineStatus();
      const guardianGithubLogin = await this._readGitHubLogin();
      const augmented = allSettings.map((s) => this._augmentSettings(s, routineStatus, guardianGithubLogin));
      return json({ settings: augmented });
    }

    // Repair the connection: converge the GitHub webhook event list and the
    // event-bus routines for every enabled repo. Explicit, guardian-only,
    // mutation-only entry point behind the dashboard's "Repair" affordance —
    // the GET status paths stay read-only.
    if (request.method === "POST" && route === "connection/repair") {
      if (request.caller.kind !== "guardian") {
        return json({ error: "forbidden" }, { status: 401 });
      }
      try {
        const result = await this._reconcileConnection(repo);
        const routineStatus = await this._readRoutineStatus();
        const guardianGithubLogin = await this._readGitHubLogin();
        const settings = repo
          .listAllPRReviewSettings()
          .map((s) => this._augmentSettings(s, routineStatus, guardianGithubLogin));
        return json({
          ok: true,
          repair: result,
          eventRoutineStatus: routineStatus,
          settings,
        });
      } catch (err) {
        log.error("Connection repair failed", { error: String(err) });
        return json({ error: `Connection repair failed: ${String(err)}` }, { status: 500 });
      }
    }

    // Enable/update PR review settings, wiring GitHub events through the bus.
    if (request.method === "POST" && route === "pr-review-settings") {
      const body = readJson(request);
      const repoName = (body.repo || "").trim();
      if (!repoName) {
        return json({ error: "repo is required" }, { status: 400 });
      }

      const enableAutoReview = !!body.autoReviewEnabled;
      const triggerOnCreate = body.triggerOnCreate !== undefined ? !!body.triggerOnCreate : undefined;
      const manualTriggerEnabled =
        body.manualTriggerEnabled !== undefined
          ? !!body.manualTriggerEnabled
          : body.triggerOnRequest !== undefined
            ? !!body.triggerOnRequest
            : undefined;
      const triggerOnReviewRequest = body.triggerOnReviewRequest !== undefined ? !!body.triggerOnReviewRequest : undefined;
      const triggerOnMention = body.triggerOnMention !== undefined ? !!body.triggerOnMention : undefined;
      const mentionTriggerPhrase =
        typeof body.mentionTriggerPhrase === "string"
          ? body.mentionTriggerPhrase.trim() || "PTAL"
          : undefined;
      const summaryTriggerPhrase =
        typeof body.summaryTriggerPhrase === "string"
          ? body.summaryTriggerPhrase.trim() || "summary"
          : undefined;
      const triggerOnPush = body.triggerOnPush !== undefined ? !!body.triggerOnPush : undefined;
      const customRules = body.customRules ?? null;
      const existingSettings = repo.getPRReviewSettings(repoName);
      const guardianGithubLogin = await this._readGitHubLogin();
      const triggerAccessMode = body.triggerAccessMode === undefined
        ? undefined
        : isTriggerAccessMode(body.triggerAccessMode)
          ? body.triggerAccessMode
          : null;
      if (body.triggerAccessMode !== undefined && !triggerAccessMode) {
        return json({ error: "triggerAccessMode must be 'allowlist' or 'blocklist'." }, { status: 400 });
      }
      const triggerAllowlistInput = body.triggerAllowlist !== undefined ? body.triggerAllowlist : body.manualTriggerAllowlist;
      const triggerAllowlist = triggerAllowlistInput !== undefined
        ? sanitizeGitHubLoginList(triggerAllowlistInput, guardianGithubLogin)
        : undefined;
      const triggerBlocklist = body.triggerBlocklist !== undefined
        ? sanitizeGitHubLoginList(body.triggerBlocklist, guardianGithubLogin)
        : undefined;
      const triggerWiringEnabled = enableAutoReview || !!manualTriggerEnabled;

      if (triggerWiringEnabled) {
        // A non-null webhookChannelUrl marks a legacy smee-era setting: its
        // stored githubWebhookId is a smee.io hook, NOT a connector one. Treat
        // such a repo as not-yet-subscribed so we register the connector webhook,
        // and best-effort delete the stale smee hook from GitHub.
        const isLegacySmee = !!existingSettings?.webhookChannelUrl;
        if (isLegacySmee && existingSettings?.githubWebhookId) {
          await this._removeLegacyWebhook(repoName, existingSettings.githubWebhookId);
        }

        // 1. Register Rome's own GitHub webhook (idempotent: skip if we already
        //    hold a *connector* hook id for this repo — re-registering an
        //    identical hook would be rejected by GitHub).
        let hookId = (isLegacySmee ? null : existingSettings?.githubWebhookId) || null;
        if (!hookId) {
          log.info("Subscribing to GitHub events", { repo: repoName, events: GITHUB_EVENTS });
          const subRes = await this.ctx.runAction(SUBSCRIBE_ACTION, {
            repo: repoName,
            events: [...GITHUB_EVENTS],
          });
          if (subRes.status === "error") {
            // A hook with this URL may already exist (e.g. another Rome routine
            // subscribed the repo). GitHub rejects the duplicate, but events are
            // already flowing onto the bus, so treat it as connected.
            if (/already exist|hook already|\b422\b/i.test(subRes.error)) {
              log.info("GitHub webhook already exists; events already flow to the bus", { repo: repoName });
              hookId = "existing";
            } else {
              log.error("connector_github_subscribe failed", { repo: repoName, error: subRes.error });
              return json({
                error:
                  `Failed to subscribe to GitHub events for ${repoName}: ${subRes.error}\n\n` +
                  `Tip: GitHub must be connected in Settings → Integrations (Rome-managed OAuth), ` +
                  `and this instance needs a public web address for GitHub to reach the webhook.`,
              }, { status: 500 });
            }
          } else {
            hookId = String((subRes as any)?.data?.hookId ?? "") || null;
            log.info("Subscribed to GitHub events", { repo: repoName, hookId });
          }
        }

        // 2. Ensure the shared event-bus routines exist.
        try {
          await ensureGithubRoutines(this.runAction);
        } catch (err) {
          log.error("Failed to ensure event routines", { repo: repoName, error: String(err) });
          return json({
            error: `Subscribed the webhook, but failed to create the event routine: ${String(err)}`,
          }, { status: 500 });
        }

        const settings = repo.upsertPRReviewSettings(repoName, {
          autoReviewEnabled: enableAutoReview,
          triggerOnCreate,
          triggerOnRequest: manualTriggerEnabled,
          triggerOnReviewRequest,
          triggerOnMention,
          triggerOnPush,
          triggerAccessMode: triggerAccessMode ?? undefined,
          triggerAllowlist,
          triggerBlocklist,
          mentionTriggerPhrase,
          summaryTriggerPhrase,
          customRules,
          webhookChannelUrl: null,
          githubWebhookId: hookId,
        });

        return json({
          settings: this._augmentSettings(settings, await this._readRoutineStatus(), guardianGithubLogin),
          setup: {
            githubWebhookId: hookId,
            webhookConnected: !!hookId,
            message:
              enableAutoReview
                ? "Auto PR review enabled. Registered Rome's GitHub webhook; events now flow via the event bus."
                : "Manual trigger enabled. Registered Rome's GitHub webhook; request-review and PTAL events now flow via the event bus.",
          },
        });
      }

      // --- DISABLE all webhook-driven triggers for this repo ---
      // Remove this repo's connector-managed GitHub webhook (best-effort).
      const unsubRes = await this.ctx.runAction(UNSUBSCRIBE_ACTION, { repo: repoName }).catch(
        (err): { status: "error"; error: string } => ({ status: "error", error: String(err) }),
      );
      if (unsubRes.status === "error") {
        log.warn("connector_github_unsubscribe failed (continuing)", { repo: repoName, error: unsubRes.error });
      }
      // Also clean up any lingering legacy smee.io hook on this repo.
      if (existingSettings?.webhookChannelUrl && existingSettings?.githubWebhookId) {
        await this._removeLegacyWebhook(repoName, existingSettings.githubWebhookId);
      }

      const settings = repo.upsertPRReviewSettings(repoName, {
        autoReviewEnabled: false,
        triggerOnCreate,
        triggerOnRequest: manualTriggerEnabled,
        triggerOnReviewRequest,
        triggerOnMention,
        triggerOnPush,
        triggerAccessMode: triggerAccessMode ?? undefined,
        triggerAllowlist,
        triggerBlocklist,
        mentionTriggerPhrase,
        summaryTriggerPhrase,
        customRules,
        webhookChannelUrl: null,
        githubWebhookId: null,
      });

      // If no repo uses auto-review anymore, tear down the shared routines so
      // they don't fire as no-ops.
      const stillEnabled = repo.listAllPRReviewSettings().some((s) => s.autoReviewEnabled || s.triggerOnRequest);
      if (!stillEnabled) {
        await removeGithubRoutines(this.runAction).catch((err) =>
          log.warn("Failed to remove event routines", { error: String(err) }),
        );
      }

      return json({
        settings: this._augmentSettings(settings, await this._readRoutineStatus(), guardianGithubLogin),
        setup: {
          githubWebhookId: null,
          webhookConnected: false,
          message: "Webhook-driven PR review triggers disabled. GitHub webhook removed.",
        },
      });
    }

    // --- Project memory (new flow) ---
    // Read the current per-repo project memory + its append-only audit trail.
    if (request.method === "GET" && route === "project-memory") {
      const repoName = (request.query.get("repo") || "").trim();
      if (!repoName) return json({ error: "repo query param is required" }, { status: 400 });
      const settings = repo.getPRReviewSettings(repoName);
      const edits = repo.listMemoryEdits(repoName, 50);
      return json({ repo: repoName, projectMemory: settings?.projectMemory ?? null, edits });
    }

    // Save project memory through the single write entry (the action), never the
    // DB directly — so every change flows through one audit trail (design §5③).
    if (request.method === "POST" && route === "project-memory") {
      if (request.caller.kind !== "guardian") {
        return json({ error: "forbidden" }, { status: 401 });
      }
      const body = readJson(request);
      const repoName = (body.repo || "").trim();
      if (!repoName) return json({ error: "repo is required" }, { status: 400 });
      const content = typeof body.content === "string" ? body.content : body.content == null ? null : String(body.content);
      const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : "Edited in dashboard";
      const result = await this.ctx.runAction("code-review:code-review_update_project_memory", { repo: repoName, content, summary });
      if (result.status !== "ok") {
        const error = result.status === "error" ? result.error : `update_project_memory returned ${result.status}`;
        return json({ error }, { status: 500 });
      }
      const edits = repo.listMemoryEdits(repoName, 50);
      return json({ ok: true, result: result.data, edits });
    }

    // --- New-flow mention tasks (read-only activity feed) ---
    if (request.method === "GET" && route === "mention-tasks") {
      const limitParam = parseInt(request.query.get("limit") || "20", 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
      return json({ tasks: repo.listMentionTasks(limit) });
    }

    // Single mention task (for the activity detail page).
    if (
      request.method === "GET" &&
      request.path.length === 2 &&
      request.path[0] === "mention-tasks"
    ) {
      const task = repo.getMentionTask(request.path[1]);
      if (!task) return json({ error: "not_found" }, { status: 404 });
      return json({ task });
    }

    // --- Unified activity feed (PR reviews + new-flow mention tasks) ---
    // Merges both sources into one normalized, filterable, paginated list so the
    // dashboard can show every trigger (review / question / memory / code task)
    // in a single timeline-backed feed.
    if (request.method === "GET" && route === "activity") {
      const type = (request.query.get("type") || "all").trim();
      const limitParam = parseInt(request.query.get("limit") || "20", 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
      const offsetParam = parseInt(request.query.get("offset") || "0", 10);
      const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

      const items = buildActivityItems(repo);
      const counts = computeActivityCounts(items);
      const filtered = type === "all" ? items : items.filter((i) => i.type === type);
      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return json({ items: page, total, counts, limit, offset, hasMore: offset + page.length < total });
    }

    // --- Dashboard ---
    if (request.method === "GET" && route === "dashboard") {
      const repositories = repo.listRepositories();
      const initialPageSize = 20;
      const prReviews = repo.listPRReviews(initialPageSize);
      const totalPRReviews = repo.countPRReviews();
      const allSettings = repo.listAllPRReviewSettings();

      const routineStatus = await this._readRoutineStatus();
      const guardianGithubLogin = await this._readGitHubLogin();
      const augmentedSettings = allSettings.map((s) => this._augmentSettings(s, routineStatus, guardianGithubLogin));

      const recentMentionTasks = repo.listMentionTasks(10);
      const repoStats = repo.getRepoStats(14);
      const activityCounts = computeActivityCounts(buildActivityItems(repo));

      return json({
        repositories,
        recentPRReviews: prReviews,
        prReviewSettings: augmentedSettings,
        recentMentionTasks,
        repoStats,
        activityCounts,
        stats: {
          totalRepos: repositories.length,
          totalPRReviews,
        },
      });
    }

    return json(
      { error: "not_found", message: `Unknown route: /${route}` },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new GuardianApiHandler(ctx);
}
