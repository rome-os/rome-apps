import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createAppLogger } from "@rome-os/app-runtime";
import { createTriageRepository, type RepoSettings, type TriageRepository } from "../db/repositories/repo.js";
import { fetchRepoLabels, normalizeRepoSlug, parseIssueUrl, readGitHubLogin, listOpenIssues, validateRepoSlug } from "../utils/github.js";
import { formatCliError } from "../utils/cli-errors.js";
import { DEFAULT_DIMENSIONS, type DimensionsEnabled } from "../utils/taxonomy.js";
import { planProvision, provisionRepo } from "../utils/provision.js";
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

const log = createAppLogger("issue-triage:api");

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readJson(request: RomeAppApiRequest): any {
  try {
    if (!request.body || request.body.byteLength === 0) return {};
    return JSON.parse(new TextDecoder().decode(request.body));
  } catch {
    return {};
  }
}

const BATCH_CAP = 50;

class IssueTriageApiHandler implements RomeAppApiHandler {
  private readonly runAction: RunAction;

  constructor(private readonly ctx: RomeAppContext) {
    this.runAction = (name, args) => this.ctx.runAction(name, args);
    // Boot self-heal: re-subscribe webhooks and (re)create routines for every
    // repo whose auto-triage is enabled. Fire-and-forget; errors are logged.
    void this._reconcileConnection(createTriageRepository(this.ctx.db)).catch((err) =>
      log.error("Boot reconcile failed", { error: String(err) }),
    );
  }

  private async _reconcileConnection(
    repo: TriageRepository,
  ): Promise<{ activeRepos: number; hookUpdates: number; routinesEnsured: boolean; webhookErrors: string[] }> {
    const active = repo.listAllRepoSettings().filter((s) => s.autoTriageEnabled && !s.webhookChannelUrl);
    let hookUpdates = 0;
    const webhookErrors: string[] = [];

    for (const s of active) {
      try {
        const subRes = await this.ctx.runAction(SUBSCRIBE_ACTION, { repo: s.repo, events: [...GITHUB_EVENTS] });
        if (subRes.status === "error") {
          if (!/already exist|hook already|\b422\b/i.test(subRes.error)) {
            webhookErrors.push(`${s.repo}: ${subRes.error}`);
            log.warn("Reconcile subscribe failed", { repo: s.repo, error: subRes.error });
          }
          continue;
        }
        const newHookId = String((subRes as any)?.data?.hookId ?? "") || null;
        if (newHookId && newHookId !== s.githubWebhookId) {
          repo.upsertRepoSettings(s.repo, { githubWebhookId: newHookId, webhookChannelUrl: null });
          hookUpdates += 1;
        }
      } catch (err) {
        webhookErrors.push(`${s.repo}: ${String(err)}`);
        log.warn("Reconcile subscribe threw", { repo: s.repo, error: String(err) });
      }
    }

    if (active.length > 0) {
      await ensureGithubRoutines(this.runAction);
    }

    return { activeRepos: active.length, hookUpdates, routinesEnsured: active.length > 0, webhookErrors };
  }

  private async _readRoutineStatus(): Promise<GithubRoutineStatus | null> {
    try {
      const routines = await this.ctx.listRoutines();
      const seen = new Map<string, boolean>();
      for (const routine of routines) {
        if (routine.actionName !== HANDLER_ACTION) continue;
        const event = typeof routine.args?.githubEvent === "string" ? routine.args.githubEvent : "";
        if (!GITHUB_EVENTS.includes(event as any)) continue;
        seen.set(event, routine.enabled === true);
      }
      const required = [...GITHUB_EVENTS];
      const present = required.filter((e) => seen.has(e));
      const enabled = required.filter((e) => seen.get(e) === true);
      const missing = required.filter((e) => !seen.has(e));
      const disabled = required.filter((e) => seen.has(e) && seen.get(e) !== true);
      return { ready: missing.length === 0 && disabled.length === 0, required, present, enabled, missing, disabled };
    } catch (err) {
      log.warn("Failed to read routine status", { error: String(err) });
      return null;
    }
  }

  private _augmentSettings(settings: RepoSettings, routineStatus: GithubRoutineStatus | null) {
    const webhookConnected = !!settings.githubWebhookId && !settings.webhookChannelUrl;
    const eventRoutinesReady = routineStatus?.ready ?? null;
    const triggerWiringHealthy = settings.autoTriageEnabled && webhookConnected && eventRoutinesReady === true;
    return {
      ...settings,
      webhookConnected,
      eventRoutinesReady,
      eventRoutineStatus: routineStatus,
      triggerWiringHealthy,
    };
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");
    const repo = createTriageRepository(this.ctx.db);

    // --- gh auth status ---
    if (request.method === "GET" && route === "gh-auth-status") {
      const login = readGitHubLogin();
      return json({ loggedIn: Boolean(login), login });
    }

    // --- app info ---
    if (request.method === "GET" && request.path.length === 0) {
      return json({ appId: this.ctx.app.id, version: this.ctx.app.version, status: "ok" });
    }

    // --- repositories ---
    if (request.method === "GET" && route === "repositories") {
      return json({ repositories: repo.listRepositories() });
    }
    if (request.method === "POST" && route === "repositories") {
      const body = readJson(request);
      const input = String(body.slug || body.url || "").trim();
      if (!input) return json({ error: "slug or url is required" }, { status: 400 });
      const slug = normalizeRepoSlug(input);
      try {
        validateRepoSlug(slug);
      } catch {
        return json({ error: "Invalid repository. Expected owner/name or a github.com URL." }, { status: 400 });
      }
      const name = String(body.name || "").trim() || slug;
      const added = repo.addRepository(slug, name);

      // Ensure a settings row exists (defaults), then provision labels once.
      const settings = repo.getRepoSettings(slug) ?? repo.upsertRepoSettings(slug, {});
      const dims = settings.dimensionsEnabled ?? { ...DEFAULT_DIMENSIONS };
      const autoCreate = settings.autoCreateLabels ?? true;
      let provision: { reused: string[]; created: string[]; labelMap: unknown } | null = null;
      let warning: string | null = null;
      try {
        const { result } = provisionRepo(slug, dims, autoCreate);
        repo.setRepoLabelMap(slug, result.labelMap, new Date().toISOString());
        provision = { reused: result.reused, created: result.created, labelMap: result.labelMap };
      } catch (err) {
        // Provisioning failure must not fail the add — surface a warning instead.
        warning = formatCliError(err, `Added ${slug}, but label provisioning failed`);
        log.warn("Provisioning failed on add-repo", { repo: slug, error: String(err) });
      }
      return json({ repository: added, provision, warning }, { status: 201 });
    }
    if (request.method === "GET" && request.path.length === 3 && request.path[0] === "repositories" && request.path[2] === "label-plan") {
      const target = repo.getRepository(request.path[1]);
      if (!target) return json({ error: "not_found" }, { status: 404 });
      const settings = repo.getRepoSettings(target.slug);
      const dims = settings?.dimensionsEnabled ?? { ...DEFAULT_DIMENSIONS };
      try {
        const existing = fetchRepoLabels(target.slug);
        const plan = planProvision(existing, dims);
        return json({ repo: target.slug, reuse: plan.reuse, create: plan.create });
      } catch (err) {
        return json({ error: formatCliError(err, `Failed to fetch labels for ${target.slug}`) }, { status: 500 });
      }
    }
    if (request.method === "POST" && request.path.length === 3 && request.path[0] === "repositories" && request.path[2] === "provision") {
      const target = repo.getRepository(request.path[1]);
      if (!target) return json({ error: "not_found" }, { status: 404 });
      const body = readJson(request);
      const settings = repo.getRepoSettings(target.slug) ?? repo.upsertRepoSettings(target.slug, {});
      const dims = settings.dimensionsEnabled ?? { ...DEFAULT_DIMENSIONS };
      const autoCreate = body.autoCreateLabels !== undefined ? !!body.autoCreateLabels : (settings.autoCreateLabels ?? true);
      try {
        const { result } = provisionRepo(target.slug, dims, autoCreate);
        const saved = repo.setRepoLabelMap(target.slug, result.labelMap, new Date().toISOString());
        return json({
          repo: target.slug,
          provision: { reused: result.reused, created: result.created, labelMap: result.labelMap },
          settings: this._augmentSettings(saved, await this._readRoutineStatus()),
        });
      } catch (err) {
        log.error("Provisioning failed", { repo: target.slug, error: String(err) });
        return json({ error: formatCliError(err, `Provisioning failed for ${target.slug}`) }, { status: 500 });
      }
    }
    if (request.method === "DELETE" && request.path.length === 2 && request.path[0] === "repositories") {
      repo.removeRepository(request.path[1]);
      return json({ ok: true });
    }

    // --- repo settings ---
    // A repo slug contains a `/`, which the host router forbids in a path
    // segment — so the single-repo lookup uses a `?repo=` query param.
    if (request.method === "GET" && route === "repo-settings") {
      const routineStatus = await this._readRoutineStatus();
      const repoName = request.query.get("repo");
      if (repoName) {
        const settings = repo.getRepoSettings(normalizeRepoSlug(repoName));
        return json({ settings: settings ? this._augmentSettings(settings, routineStatus) : null });
      }
      const settings = repo.listAllRepoSettings().map((s) => this._augmentSettings(s, routineStatus));
      return json({ settings });
    }

    // --- connection repair ---
    if (request.method === "POST" && route === "connection/repair") {
      try {
        const repair = await this._reconcileConnection(repo);
        const routineStatus = await this._readRoutineStatus();
        const settings = repo.listAllRepoSettings().map((s) => this._augmentSettings(s, routineStatus));
        return json({ ok: true, repair, eventRoutineStatus: routineStatus, settings });
      } catch (err) {
        log.error("Connection repair failed", { error: String(err) });
        return json({ error: `Connection repair failed: ${String(err)}` }, { status: 500 });
      }
    }

    // --- save repo settings ---
    if (request.method === "POST" && route === "repo-settings") {
      const body = readJson(request);
      const repoName = normalizeRepoSlug(String(body.repo || "").trim());
      if (!repoName) return json({ error: "repo is required" }, { status: 400 });
      try {
        validateRepoSlug(repoName);
      } catch {
        return json({ error: "Invalid repo. Expected owner/name." }, { status: 400 });
      }

      const enableAuto = !!body.autoTriageEnabled;
      const triggerOnOpen = body.triggerOnOpen !== undefined ? !!body.triggerOnOpen : undefined;
      const triggerOnEdit = body.triggerOnEdit !== undefined ? !!body.triggerOnEdit : undefined;
      const createMissingLabels = body.createMissingLabels !== undefined ? !!body.createMissingLabels : undefined;
      const autoCreateLabels = body.autoCreateLabels !== undefined ? !!body.autoCreateLabels : undefined;
      const customRules = body.customRules !== undefined ? (body.customRules ?? null) : undefined;
      const dimensionsEnabled: DimensionsEnabled | undefined = body.dimensionsEnabled
        ? {
            type: !!body.dimensionsEnabled.type,
            priority: !!body.dimensionsEnabled.priority,
            area: !!body.dimensionsEnabled.area,
            flags: !!body.dimensionsEnabled.flags,
          }
        : undefined;

      const existing = repo.getRepoSettings(repoName);

      if (enableAuto) {
        // 1. Subscribe Rome's GitHub webhook (idempotent).
        let hookId = existing?.githubWebhookId || null;
        if (!hookId) {
          const subRes = await this.ctx.runAction(SUBSCRIBE_ACTION, { repo: repoName, events: [...GITHUB_EVENTS] });
          if (subRes.status === "error") {
            if (/already exist|hook already|\b422\b/i.test(subRes.error)) {
              hookId = "existing";
            } else {
              log.error("connector_github_subscribe failed", { repo: repoName, error: subRes.error });
              return json({
                error:
                  `Failed to subscribe to GitHub events for ${repoName}: ${subRes.error}\n\n` +
                  `Tip: GitHub must be connected in Settings → Connections, and this instance needs a ` +
                  `public web address for GitHub to reach the webhook.`,
              }, { status: 500 });
            }
          } else {
            hookId = String((subRes as any)?.data?.hookId ?? "") || "existing";
          }
        }

        // 2. Ensure the shared event-bus routines exist.
        try {
          await ensureGithubRoutines(this.runAction);
        } catch (err) {
          log.error("Failed to ensure routines", { repo: repoName, error: String(err) });
          return json({ error: `Subscribed the webhook, but failed to create the event routine: ${String(err)}` }, { status: 500 });
        }

        const settings = repo.upsertRepoSettings(repoName, {
          autoTriageEnabled: true,
          triggerOnOpen,
          triggerOnEdit,
          createMissingLabels,
          autoCreateLabels,
          customRules,
          dimensionsEnabled,
          githubWebhookId: hookId,
          webhookChannelUrl: null,
        });
        return json({
          settings: this._augmentSettings(settings, await this._readRoutineStatus()),
          setup: { webhookConnected: !!hookId, message: "Auto-triage enabled. Registered Rome's GitHub webhook; issue events now flow via the event bus." },
        });
      }

      // Disable path: unsubscribe + tear down shared routines if no repo left.
      const unsubRes = await this.ctx.runAction(UNSUBSCRIBE_ACTION, { repo: repoName }).catch(
        (err): { status: "error"; error: string } => ({ status: "error", error: String(err) }),
      );
      if (unsubRes.status === "error") {
        log.warn("connector_github_unsubscribe failed (continuing)", { repo: repoName, error: unsubRes.error });
      }

      const settings = repo.upsertRepoSettings(repoName, {
        autoTriageEnabled: false,
        triggerOnOpen,
        triggerOnEdit,
        createMissingLabels,
        autoCreateLabels,
        customRules,
        dimensionsEnabled,
        githubWebhookId: null,
        webhookChannelUrl: null,
      });

      const stillEnabled = repo.listAllRepoSettings().some((s) => s.autoTriageEnabled);
      if (!stillEnabled) {
        await removeGithubRoutines(this.runAction).catch((err) => log.warn("Failed to remove routines", { error: String(err) }));
      }

      return json({
        settings: this._augmentSettings(settings, await this._readRoutineStatus()),
        setup: { webhookConnected: false, message: "Auto-triage disabled. GitHub webhook removed." },
      });
    }

    // --- triage results ---
    if (request.method === "GET" && route === "triage-results") {
      const limitParam = parseInt(request.query.get("limit") || "20", 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
      const offsetParam = parseInt(request.query.get("offset") || "0", 10);
      const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
      const repoFilter = request.query.get("repo");
      if (repoFilter) {
        const slug = normalizeRepoSlug(repoFilter);
        const results = repo.listResultsByRepo(slug, limit);
        return json({ results, total: results.length, limit, offset: 0, hasMore: false });
      }
      const results = repo.listResults(limit, offset);
      const total = repo.countResults();
      return json({ results, total, limit, offset, hasMore: offset + results.length < total, counts: repo.countResultsByStatus() });
    }
    if (request.method === "GET" && request.path.length === 2 && request.path[0] === "triage-results") {
      const result = repo.getResult(request.path[1]);
      if (!result) return json({ error: "not_found" }, { status: 404 });
      return json({ result });
    }

    // --- manual single triage ---
    if (request.method === "POST" && route === "triage") {
      const body = readJson(request);
      let repoSlug = "";
      let issueNumber = 0;
      const issueUrl = String(body.issueUrl || "").trim();
      if (issueUrl) {
        const parsed = parseIssueUrl(issueUrl);
        if (!parsed) return json({ error: "Invalid issue URL. Expected https://github.com/owner/repo/issues/123" }, { status: 400 });
        repoSlug = parsed.repo;
        issueNumber = parsed.issueNumber;
      } else if (body.repo && body.issueNumber) {
        repoSlug = normalizeRepoSlug(String(body.repo));
        issueNumber = parseInt(String(body.issueNumber), 10);
      } else {
        return json({ error: "Either issueUrl or both repo and issueNumber are required." }, { status: 400 });
      }
      if (!issueNumber || isNaN(issueNumber)) return json({ error: "Invalid issue number." }, { status: 400 });
      try {
        validateRepoSlug(repoSlug);
      } catch {
        return json({ error: "Invalid repository slug." }, { status: 400 });
      }

      const queued = repo.createQueuedResult({ repo: repoSlug, issueNumber, actor: "manual" });
      await this.ctx.runAction(
        "issue-triage:issue-triage_triage-issue",
        { repo: repoSlug, issueNumber, resultId: queued.id, actor: "manual" },
        { detached: true },
      );
      return json({ queued: true, resultId: queued.id, repo: repoSlug, issueNumber }, { status: 202 });
    }

    // --- batch triage ---
    if (request.method === "POST" && route === "triage-batch") {
      const body = readJson(request);
      const repoSlug = normalizeRepoSlug(String(body.repo || "").trim());
      if (!repoSlug) return json({ error: "repo is required" }, { status: 400 });
      try {
        validateRepoSlug(repoSlug);
      } catch {
        return json({ error: "Invalid repository slug." }, { status: 400 });
      }
      let issues: Array<{ number: number; title: string; htmlUrl: string }>;
      try {
        issues = listOpenIssues(repoSlug, BATCH_CAP);
      } catch (err) {
        return json({ error: formatCliError(err, `Failed to list open issues in ${repoSlug}`) }, { status: 500 });
      }
      let queuedCount = 0;
      for (const issue of issues.slice(0, BATCH_CAP)) {
        const queued = repo.createQueuedResult({
          repo: repoSlug,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueUrl: issue.htmlUrl,
          actor: "batch",
        });
        await this.ctx.runAction(
          "issue-triage:issue-triage_triage-issue",
          { repo: repoSlug, issueNumber: issue.number, resultId: queued.id, actor: "batch" },
          { detached: true },
        );
        queuedCount += 1;
      }
      return json({ queued: queuedCount, repo: repoSlug, total: issues.length, cap: BATCH_CAP }, { status: 202 });
    }

    // --- dashboard aggregate ---
    if (request.method === "GET" && route === "dashboard") {
      const repositories = repo.listRepositories();
      const routineStatus = await this._readRoutineStatus();
      const settings = repo.listAllRepoSettings().map((s) => this._augmentSettings(s, routineStatus));
      const recentResults = repo.listResults(20);
      const counts = repo.countResultsByStatus();
      return json({
        repositories,
        repoSettings: settings,
        recentResults,
        counts,
        stats: {
          totalRepos: repositories.length,
          totalTriaged: repo.countResults(),
          succeeded: counts.succeeded ?? 0,
          failed: counts.failed ?? 0,
        },
      });
    }

    return json({ error: "not_found", message: `Unknown route: /${route}` }, { status: 404 });
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new IssueTriageApiHandler(ctx);
}
