import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createDigestRepository, type DigestConfig } from "../db/repositories/digest.js";

/**
 * Public name of the agent shipped by this app (see agents/summarizer.yaml).
 * Scheduling a digest binds the digest's Discord channel to this agent so that
 * follow-up conversation in the channel routes to the summarizer instead of the
 * default "main" agent.
 */
const SUMMARIZER_AGENT_NAME = "discord-digest-summarizer";

const execFileAsync = promisify(execFile);

// Rome writes the GitHub OAuth access token to this file when GitHub is
// connected in Settings → Integrations, and removes it on disconnect. Reading
// it directly is more reliable than asking the `gh` CLI: Rome's disconnect
// path only *tries* to log `gh` out and swallows failures, so a stale gh
// session can outlive a Rome disconnect.
const GITHUB_TOKEN_FILE = process.env.ROME_GITHUB_TOKEN_FILE?.trim() || "/run/rome/github-oauth-token";

async function readGithubAccessToken(): Promise<string | null> {
  try {
    const token = (await readFile(GITHUB_TOKEN_FILE, "utf8")).trim();
    return token || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function ghAuthEnv(token: string): NodeJS.ProcessEnv {
  // Pin gh to the Rome-issued token so we don't accidentally use a stale
  // cached session that survived a Rome disconnect.
  return { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token };
}

async function ghApiPaginatedFullNames(token: string, path: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", path, "--jq", ".[].full_name"],
    { maxBuffer: 16 * 1024 * 1024, timeout: 30_000, env: ghAuthEnv(token) },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[^/\s]+\/[^/\s]+$/.test(line));
}

async function ghApiOrgLogins(token: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", "/user/orgs?per_page=100", "--jq", ".[].login"],
    { maxBuffer: 4 * 1024 * 1024, timeout: 30_000, env: ghAuthEnv(token) },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9._-]+$/.test(line));
}

async function listAccessibleGithubRepos(): Promise<{ repos: string[]; warnings?: string[]; error?: string }> {
  const token = await readGithubAccessToken();
  if (!token) {
    return { repos: [], error: "GitHub is not connected. Open Settings → Integrations and connect GitHub." };
  }
  try {
    // `/user/repos` only returns org repos when the org has approved the OAuth
    // app. Most orgs restrict that by default, so we additionally enumerate
    // `/user/orgs` and then call `/orgs/<org>/repos` per org — that endpoint
    // returns every repo the token can read regardless of OAuth-app approval,
    // as long as the `read:org` + `repo` scopes are granted.
    const warnings: string[] = [];
    const all = new Set<string>();

    try {
      for (const slug of await ghApiPaginatedFullNames(
        token,
        "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=updated",
      )) {
        all.add(slug);
      }
    } catch (err) {
      warnings.push(`/user/repos failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let orgs: string[] = [];
    try {
      orgs = await ghApiOrgLogins(token);
    } catch (err) {
      warnings.push(`/user/orgs failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const orgResults = await Promise.all(
      orgs.map(async (org) => {
        try {
          return await ghApiPaginatedFullNames(token, `/orgs/${org}/repos?per_page=100&type=all&sort=updated`);
        } catch (err) {
          warnings.push(`/orgs/${org}/repos failed: ${err instanceof Error ? err.message : String(err)}`);
          return [] as string[];
        }
      }),
    );
    for (const list of orgResults) {
      for (const slug of list) all.add(slug);
    }

    return { repos: Array.from(all).sort(), warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found/i.test(message)) {
      return { repos: [], error: "gh CLI is not installed on the Rome host." };
    }
    if (/authentication required|gh auth login|HTTP 401/i.test(message)) {
      return { repos: [], error: "GitHub is not connected. Open Settings → Integrations and connect GitHub." };
    }
    return { repos: [], error: `Failed to list GitHub repos: ${message}` };
  }
}

interface Routine {
  id: string;
  key?: string;
  actionName: string;
  args: Record<string, unknown>;
}

interface RoutineListingContext {
  listRoutines(): Promise<Routine[]>;
}

interface ChannelBindingResult {
  bound: boolean;
  agentName: string | null;
  warning?: string;
}

interface RoutineDeleteResult {
  routineId: string;
  deleted: boolean;
  error?: string;
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readJsonBody<T>(request: RomeAppApiRequest): T | null | undefined {
  if (!request.body || request.body.byteLength === 0) return null;
  const text = new TextDecoder().decode(request.body);
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function validateConfigPayload(payload: Partial<DigestConfig> | null | undefined): string | null {
  if (payload === undefined) return "invalid_json";
  if (!payload || typeof payload !== "object") return "body_required";
  if (!payload.threadId || typeof payload.threadId !== "string" || !payload.threadId.trim()) {
    return "thread_id_required";
  }
  const windowHours = Number(payload.windowHours ?? 24);
  if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > 168) return "invalid_window_hours";
  return null;
}

function scheduleLabel(rrule: string): string {
  if (rrule.includes("BYDAY=MO,TU,WE,TH,FR")) return "Weekdays";
  if (rrule.includes("FREQ=WEEKLY")) return "Weekly";
  return "Daily";
}

function routineTargetsConfig(routine: Routine, configId: string): boolean {
  if (routine.key === `discord-digest:${configId}`) return true;
  return (
    routine.actionName === "discord-digest_run_digest" &&
    !!routine.args &&
    (routine.args as { configId?: unknown }).configId === configId
  );
}

class DiscordDigestApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  /**
   * Route (or unroute) a digest's Discord channel to the summarizer agent by
   * writing the channel→agent binding that `/settings/channels` reads — the
   * `discord.channels` settings the `discord_bot_manage` system action owns.
   *
   * Pass `agentName` to bind, or `null` to clear the binding (restoring the
   * default "main" agent). Best-effort: a failure here never fails the caller's
   * primary operation, since the schedule / delete has already been applied.
   */
  private async setChannelAgentBinding(
    config: Pick<DigestConfig, "channel" | "threadId">,
    agentName: string | null,
  ): Promise<ChannelBindingResult> {
    // Channel routing only exists for Discord; other channels have no binding.
    if (config.channel !== "discord") {
      return { bound: false, agentName, warning: `channel "${config.channel}" does not support agent routing` };
    }
    if (!config.threadId) {
      return { bound: false, agentName, warning: "missing threadId" };
    }
    try {
      const result = await this.ctx.runAction("discord_bot_manage", {
        op: "set",
        channels: [{ id: config.threadId }],
        config: { agentName },
      });
      if (result.status !== "ok") {
        return { bound: false, agentName, warning: (result.status === "error" ? result.error : undefined) ?? "discord_bot_manage failed" };
      }
      return { bound: agentName !== null, agentName };
    } catch (err) {
      return { bound: false, agentName, warning: err instanceof Error ? err.message : String(err) };
    }
  }

  private async deleteRoutine(routineId: string): Promise<RoutineDeleteResult> {
    try {
      const result = await this.ctx.runAction("delete_routine", { routineId });
      if (result.status === "ok") return { routineId, deleted: true };
      return {
        routineId,
        deleted: false,
        error: result.status === "error" ? result.error : "delete_routine failed",
      };
    } catch (err) {
      return { routineId, deleted: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");
    const repo = createDigestRepository(this.ctx.db);

    if (request.method === "GET" && request.path.length === 0) {
      return json({ appId: this.ctx.app.id, version: this.ctx.app.version, status: "ok" });
    }

    if (request.method === "GET" && route === "state") {
      return json({ configs: repo.listConfigs(), runs: repo.listRuns(25) });
    }

    if (request.method === "GET" && route === "github/repos") {
      const result = await listAccessibleGithubRepos();
      return json(result, { status: result.error ? 502 : 200 });
    }

    if (request.method === "POST" && route === "configs") {
      const payload = readJsonBody<Partial<DigestConfig>>(request);
      const error = validateConfigPayload(payload);
      if (error) return json({ error }, { status: 400 });
      const saved = repo.upsertConfig(payload as Partial<DigestConfig> & { threadId: string });
      return json({ config: saved }, { status: 201 });
    }

    if (request.method === "POST" && request.path[0] === "configs" && request.path[2] === "update") {
      const id = request.path[1];
      const existing = repo.getConfig(id);
      if (!existing) return json({ error: "not_found" }, { status: 404 });
      const payload = readJsonBody<Partial<DigestConfig>>(request);
      if (payload === undefined) return json({ error: "invalid_json" }, { status: 400 });
      const saved = repo.upsertConfig({ ...existing, ...(payload ?? {}), id, threadId: payload?.threadId ?? existing.threadId });
      return json({ config: saved });
    }

    if (request.method === "DELETE" && request.path[0] === "configs" && request.path.length === 2) {
      const id = request.path[1];
      const existing = repo.getConfig(id);
      if (!existing) return json({ error: "not_found" }, { status: 404 });

      const routines = await (this.ctx as unknown as RoutineListingContext).listRoutines();
      const routineIds = routines.filter((routine) => routineTargetsConfig(routine, id)).map((routine) => routine.id);
      const archived = existing.active ? repo.archiveConfig(id) : existing;
      const routineDeletes = await Promise.all(routineIds.map((routineId) => this.deleteRoutine(routineId)));
      const deletedRoutineIds = routineDeletes.filter((result) => result.deleted).map((result) => result.routineId);
      const routineDeleteFailures = routineDeletes
        .filter((result): result is RoutineDeleteResult & { error: string } => !result.deleted && Boolean(result.error))
        .map(({ routineId, error }) => ({ routineId, error }));

      // Clear the channel→agent binding created when this digest was scheduled,
      // so a deleted digest doesn't leave the channel routed to the summarizer.
      // Multiple digests can target the same channel, so only clear once no
      // other active digest still depends on the binding (the just-archived
      // config is already inactive and excluded here).
      const stillUsedBy = repo.listActiveConfigsForChannel(existing.channel, existing.threadId);
      const binding: ChannelBindingResult =
        stillUsedBy.length > 0
          ? {
              bound: false,
              agentName: null,
              warning: `binding kept: ${stillUsedBy.length} other active digest(s) still target this channel`,
            }
          : await this.setChannelAgentBinding(existing, null);

      return json({
        success: true,
        config: archived,
        routineIds,
        deletedRoutineIds,
        routineDeleteFailures,
        binding,
        message:
          routineDeleteFailures.length > 0
            ? "Digest deleted, but one or more recurring schedules could not be removed."
            : deletedRoutineIds.length > 0
              ? "Digest deleted and recurring schedule removed."
            : "Digest deleted.",
      });
    }

    if (request.method === "POST" && request.path[0] === "configs" && request.path[2] === "send") {
      const id = request.path[1];
      const existing = repo.getConfig(id);
      if (!existing) return json({ error: "not_found" }, { status: 404 });
      const payload = readJsonBody<{ runId?: string }>(request);
      if (payload === undefined) return json({ error: "invalid_json" }, { status: 400 });
      const runId = payload?.runId;
      if (!runId) return json({ error: "run_id_required" }, { status: 400 });

      const run = repo.getRun(runId);
      if (!run || run.configId !== id) return json({ error: "run_not_found" }, { status: 404 });
      if (run.status !== "completed" || !run.summary) {
        return json({ error: "run_not_previewable" }, { status: 400 });
      }

      const sent = await this.ctx.runAction("send_message", {
        channel: run.channel,
        threadId: run.threadId,
        text: run.summary,
      });
      if (sent.status !== "ok") {
        return json({ success: false, error: `send_message failed: ${sent.status === "error" ? sent.error : "unknown error"}` }, { status: 500 });
      }

      const updated = repo.markRunSent(runId);
      repo.markConfigRun(id);
      return json({ success: true, data: { run: updated, summary: run.summary, sent: true } });
    }

    if (request.method === "POST" && request.path[0] === "configs" && request.path[2] === "run") {
      const id = request.path[1];
      const existing = repo.getConfig(id);
      if (!existing) return json({ error: "not_found" }, { status: 404 });
      const payload = readJsonBody<{ send?: boolean }>(request);
      if (payload === undefined) return json({ error: "invalid_json" }, { status: 400 });
      const result = await this.ctx.runAction("discord-digest_run_digest", {
        configId: id,
        send: payload?.send ?? existing.sendAsBot,
      });
      return json(
        result.status === "ok"
          ? { success: true, data: result.data }
          : { success: false, error: result.status === "error" ? result.error : "run failed" },
        { status: result.status === "ok" ? 200 : 500 },
      );
    }

    if (request.method === "POST" && request.path[0] === "configs" && request.path[2] === "schedule") {
      const id = request.path[1];
      const existing = repo.getConfig(id);
      if (!existing) return json({ error: "not_found" }, { status: 404 });
      if (!existing.active) return json({ error: "config_inactive" }, { status: 400 });

      const name = `Discord Digest: ${existing.name} (${id.slice(0, 8)})`;
      const note = `${scheduleLabel(existing.rrule)} at ${existing.localTime} (${existing.tzid})`;
      const routines = await (this.ctx as unknown as RoutineListingContext).listRoutines();
      const alreadyScheduled = routines.find((routine) => routineTargetsConfig(routine, id));

      let routine: unknown = alreadyScheduled;
      if (!alreadyScheduled) {
        const result = await this.ctx.runAction("create_routine", {
          key: `discord-digest:${id}`,
          name,
          trigger: {
            type: "schedule",
            tzid: existing.tzid,
            // The app lets the user explicitly choose a timezone for a Discord
            // channel digest, so keep that wall-clock zone pinned rather than
            // floating with the guardian's current location.
            tzMode: "fixed",
            localTime: existing.localTime,
            rrule: existing.rrule,
          },
          actionName: "discord-digest_run_digest",
          args: { configId: id, send: true },
        });
        if (result.status !== "ok") {
          return json(
            { success: false, error: result.status === "error" ? result.error : "create_routine failed" },
            { status: 500 },
          );
        }
        routine = result.data;
      }

      repo.markConfigScheduled(id, note);

      // Bind the digest's channel to the summarizer so follow-up conversation in
      // that channel routes to discord-digest-summarizer instead of "main".
      const binding = await this.setChannelAgentBinding(existing, SUMMARIZER_AGENT_NAME);

      return json({ success: true, data: { routine, alreadyScheduled: Boolean(alreadyScheduled), scheduleNote: note, binding } });
    }

    return json({ error: "not_found", message: `Unknown Discord Digest API route: /${route}` }, { status: 404 });
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new DiscordDigestApiHandler(ctx);
}
