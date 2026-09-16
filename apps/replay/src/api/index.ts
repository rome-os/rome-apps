import type { RomeAppApiHandler, RomeAppApiRequest, RomeAppContext } from "@rome-os/app-runtime";
import { createTracesRepository } from "../db/repositories/traces.js";
import { createPlansRepository } from "../db/repositories/plans.js";
import { createSessionsRepository } from "../db/repositories/sessions.js";
import { parseTrace, summarizeTrace, TraceParseError } from "../lib/trace.js";
import { clampSpeed, clampTurnBudgetMs } from "../lib/plan-settings.js";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type JsonBody = { ok: true; value: unknown } | { ok: false; reason: "empty" | "parse_error" };

function readJsonBody(request: RomeAppApiRequest): JsonBody {
  if (!request.body || request.body.byteLength === 0) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(request.body)) };
  } catch {
    return { ok: false, reason: "parse_error" };
  }
}

/** One file in a multi-upload: the file name and its raw text contents. */
interface UploadEntry {
  name: string;
  content: string;
}

function readUploadEntries(value: unknown): UploadEntry[] | null {
  if (!value || typeof value !== "object") return null;
  const traces = (value as { traces?: unknown }).traces;
  if (!Array.isArray(traces)) return null;
  const entries: UploadEntry[] = [];
  for (const entry of traces) {
    if (!entry || typeof entry !== "object") return null;
    const name = (entry as { name?: unknown }).name;
    const content = (entry as { content?: unknown }).content;
    if (typeof name !== "string" || typeof content !== "string") return null;
    entries.push({ name, content });
  }
  return entries;
}

class ReplayApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const { method, path } = request;
    const route = path.join("/");

    if (method === "GET" && path.length === 0) {
      return json({ appId: this.ctx.app.id, version: this.ctx.app.version, status: "ok" });
    }

    // GET /state — the trace library for the list UI.
    if (method === "GET" && route === "state") {
      const traces = await createTracesRepository(this.ctx.db).list();
      return json({ traces });
    }

    // POST /traces — upload one or more trace.json files (parsed client-side
    // into { name, content } so we never touch multipart in the sandbox).
    if (method === "POST" && route === "traces") {
      return this.uploadTraces(request);
    }

    // GET /traces/:id/content — raw trace JSON, for re-download / export.
    if (method === "GET" && path[0] === "traces" && path[2] === "content" && path.length === 3) {
      const trace = await createTracesRepository(this.ctx.db).byId(path[1]);
      if (!trace) return json({ error: "not_found" }, { status: 404 });
      return new Response(trace.contentJson, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(trace.name)}"`,
        },
      });
    }

    // PATCH /traces/:id — rename.
    if (method === "PATCH" && path[0] === "traces" && path.length === 2) {
      const body = readJsonBody(request);
      if (!body.ok) return json({ error: "invalid_json" }, { status: 400 });
      const name = (body.value as { name?: unknown }).name;
      if (typeof name !== "string" || !name.trim()) {
        return json({ error: "name required" }, { status: 400 });
      }
      const updated = await createTracesRepository(this.ctx.db).rename(
        path[1],
        name.trim().slice(0, 200),
      );
      if (!updated) return json({ error: "not_found" }, { status: 404 });
      return json({ trace: updated });
    }

    // DELETE /traces/:id
    if (method === "DELETE" && path[0] === "traces" && path.length === 2) {
      const removed = await createTracesRepository(this.ctx.db).remove(path[1]);
      if (!removed) return json({ error: "not_found" }, { status: 404 });
      return json({ removed: true });
    }

    // POST /plans — create an ordered replay plan from a list of trace ids.
    if (method === "POST" && route === "plans") {
      return this.createPlan(request);
    }

    // GET /plans/:id — a plan with its ordered trace summaries.
    if (method === "GET" && path[0] === "plans" && path.length === 2) {
      const plan = await createPlansRepository(this.ctx.db).byId(path[1]);
      if (!plan) return json({ error: "not_found" }, { status: 404 });
      const traces = await createTracesRepository(this.ctx.db).summariesByIds(plan.traceIds);
      return json({
        plan: {
          id: plan.id,
          name: plan.name,
          createdAt: plan.createdAt,
          speed: plan.speed,
          turnBudgetMs: plan.turnBudgetMs,
        },
        traces,
      });
    }

    // GET /sessions/:sessionId/progress — the replay cursor for a bound session.
    // The web driver polls this to post each turn only AFTER the previous one
    // has finished replaying (see App.tsx). Driving sequentially is what keeps
    // every turn's messages in their own monotonically-increasing time window:
    // posting all turns up front collided their user rows in the same
    // second-granularity `created_at`, and the transcript (grouped by turn but
    // ordered by each group's earliest timestamp) then interleaved the turns.
    if (method === "GET" && path[0] === "sessions" && path[2] === "progress" && path.length === 3) {
      const binding = await createSessionsRepository(this.ctx.db).get(path[1]);
      if (!binding) return json({ error: "not_found" }, { status: 404 });
      const plan = await createPlansRepository(this.ctx.db).byId(binding.planId);
      return json({ cursor: binding.cursor, total: plan?.traceIds.length ?? 0 });
    }

    // POST /sessions/bind — bind a freshly-created chat session to a plan,
    // BEFORE its first turn is posted. No race: the web UI
    // awaits this before posting any turn.
    if (method === "POST" && route === "sessions/bind") {
      const body = readJsonBody(request);
      if (!body.ok) return json({ error: "invalid_json" }, { status: 400 });
      const sessionId = (body.value as { sessionId?: unknown }).sessionId;
      const planId = (body.value as { planId?: unknown }).planId;
      if (typeof sessionId !== "string" || typeof planId !== "string") {
        return json({ error: "sessionId and planId required" }, { status: 400 });
      }
      const plan = await createPlansRepository(this.ctx.db).byId(planId);
      if (!plan) return json({ error: "plan not_found" }, { status: 404 });
      await createSessionsRepository(this.ctx.db).bind(sessionId, planId);
      return json({ ok: true });
    }

    return json(
      { error: "not_found", message: `Unknown Replay API route: /${route}` },
      { status: 404 },
    );
  }

  private async uploadTraces(request: RomeAppApiRequest): Promise<Response> {
    const body = readJsonBody(request);
    if (!body.ok) return json({ error: "invalid_json" }, { status: 400 });
    const entries = readUploadEntries(body.value);
    if (!entries)
      return json({ error: "expected { traces: [{ name, content }] }" }, { status: 400 });
    if (entries.length === 0) return json({ error: "no files" }, { status: 400 });

    const repo = createTracesRepository(this.ctx.db);
    const results = [];
    for (const entry of entries) {
      try {
        const { blocks } = parseTrace(entry.content);
        const summary = summarizeTrace(blocks);
        const inserted = await repo.insert({
          name: entry.name || "trace.json",
          sizeBytes: new TextEncoder().encode(entry.content).length,
          blockCount: summary.blockCount,
          originalUserPrompt: summary.originalUserPrompt,
          status: summary.status,
          model: summary.model,
          durationMs: summary.durationMs,
          contentJson: entry.content,
        });
        results.push({ ok: true as const, trace: inserted });
      } catch (err) {
        const reason = err instanceof TraceParseError ? err.message : "Failed to import.";
        results.push({ ok: false as const, name: entry.name, error: reason });
      }
    }
    return json({ results }, { status: 201 });
  }

  private async createPlan(request: RomeAppApiRequest): Promise<Response> {
    const body = readJsonBody(request);
    if (!body.ok) return json({ error: "invalid_json" }, { status: 400 });
    const value = body.value as {
      name?: unknown;
      traceIds?: unknown;
      speed?: unknown;
      turnBudgetMs?: unknown;
    };
    if (
      !Array.isArray(value.traceIds) ||
      value.traceIds.length === 0 ||
      !value.traceIds.every((x) => typeof x === "string")
    ) {
      return json({ error: "traceIds (non-empty string[]) required" }, { status: 400 });
    }
    // Playback settings: absent → defaults; wrong type → 400; out-of-range
    // numbers clamp (same posture as the name's slice-to-200 above).
    if (value.speed !== undefined && typeof value.speed !== "number") {
      return json({ error: "speed must be a number" }, { status: 400 });
    }
    if (value.turnBudgetMs !== undefined && typeof value.turnBudgetMs !== "number") {
      return json({ error: "turnBudgetMs must be a number" }, { status: 400 });
    }
    const traceIds = value.traceIds as string[];
    const repo = createTracesRepository(this.ctx.db);
    const traces = await repo.summariesByIds(traceIds);
    if (traces.length !== traceIds.length) {
      return json({ error: "one or more traceIds do not exist" }, { status: 400 });
    }
    const name =
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 200)
        : `Replay of ${traceIds.length} trace${traceIds.length === 1 ? "" : "s"}`;
    const plan = await createPlansRepository(this.ctx.db).insert(name, traceIds, {
      speed: value.speed !== undefined ? clampSpeed(value.speed) : undefined,
      turnBudgetMs:
        value.turnBudgetMs !== undefined ? clampTurnBudgetMs(value.turnBudgetMs) : undefined,
    });
    return json(
      {
        plan: {
          id: plan.id,
          name: plan.name,
          createdAt: plan.createdAt,
          speed: plan.speed,
          turnBudgetMs: plan.turnBudgetMs,
        },
        traces,
      },
      { status: 201 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new ReplayApiHandler(ctx);
}
