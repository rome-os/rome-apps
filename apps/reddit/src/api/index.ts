import { TextDecoder } from "node:util";
import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import {
  createRedditAgentRepository,
  type RedditAgentPostFilters,
} from "../db/repositories/reddit-agent.js";
import { ensureAiAgentSchedule, getAiAgentSchedule } from "../lib/schedule.js";
import { runAiAgentScan } from "../lib/scan-service.js";
import { DEFAULT_AI_AGENT_SCAN_CONFIG } from "../lib/scan-config.js";

type DashboardWindow = "24h" | "7d" | "30d" | "all";

function json(
  data: unknown,
  init?: ResponseInit,
): Response {
  return Response.json(data, init);
}

function parseWindow(value: string | null): DashboardWindow {
  if (value === "24h" || value === "30d" || value === "all") {
    return value;
  }
  return "7d";
}

function toSince(window: DashboardWindow): Date | undefined {
  const now = Date.now();
  switch (window) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1_000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1_000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1_000);
    case "all":
      return undefined;
  }
}

function decodeJsonBody(request: RomeAppApiRequest): Record<string, unknown> {
  if (!request.body || request.body.length === 0) {
    return {};
  }

  const raw = new TextDecoder().decode(request.body);
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

class RedditApiHandler implements RomeAppApiHandler {
  private readonly repo;

  constructor(private readonly ctx: RomeAppContext) {
    this.repo = createRedditAgentRepository(ctx.db);
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");

    if (request.method === "GET" && request.path.length === 0) {
      return json({
        appId: this.ctx.app.id,
        version: this.ctx.app.version,
        status: "ok",
      });
    }

    if (request.method === "GET" && route === "dashboard") {
      return this.getDashboard(request);
    }

    if (request.method === "POST" && route === "scan") {
      const body = decodeJsonBody(request);
      const result = await runAiAgentScan(this.ctx, {
        scanName: typeof body.scanName === "string" ? body.scanName : undefined,
      });
      return json(result);
    }

    if (request.method === "POST" && route === "schedule/ensure") {
      const body = decodeJsonBody(request);
      const result = await ensureAiAgentSchedule(this.ctx, {
        tzid: typeof body.tzid === "string" ? body.tzid : undefined,
        localTime: typeof body.localTime === "string" ? body.localTime : undefined,
      });
      return json(result);
    }

    return json(
      {
        error: "not_found",
        appId: this.ctx.app.id,
        message: `Unknown Reddit app API route: /${route}`,
      },
      { status: 404 },
    );
  }

  private async getDashboard(request: RomeAppApiRequest): Promise<Response> {
    const window = parseWindow(request.query.get("window"));
    const since = toSince(window);
    const limit = Number.parseInt(request.query.get("limit") ?? "80", 10);
    const search = request.query.get("search")?.trim() || undefined;
    const subreddit = request.query.get("subreddit")?.trim() || undefined;
    const filters: RedditAgentPostFilters = {
      since,
      search,
      subreddit,
      limit: Number.isFinite(limit) ? Math.max(10, Math.min(limit, 200)) : 80,
    };

    const [posts, runs, subreddits, queries, schedule, latestRun, totalPosts, postsInWindow, topSubreddits] =
      await Promise.all([
        this.repo.listPosts(filters),
        this.repo.listRuns(10),
        this.repo.listSubreddits(),
        this.repo.listQueries(),
        getAiAgentSchedule(this.ctx),
        this.repo.latestRun(),
        this.repo.countPosts(),
        since ? this.repo.countPostsSince(since) : this.repo.countPosts(),
        this.repo.topSubreddits(since),
      ]);

    return json({
      posts,
      runs,
      schedule,
      filters: {
        window,
        subreddit: subreddit ?? "",
        search: search ?? "",
      },
      catalog: {
        subreddits,
        queries,
      },
      stats: {
        totalPosts,
        postsInWindow,
        runCount: runs.length,
        trackedSubreddits: subreddits.length,
      },
      topSubreddits,
      latestRun,
      config: {
        scanName: DEFAULT_AI_AGENT_SCAN_CONFIG.scanName,
        cadence: "Every 3 hours",
        queryCount: DEFAULT_AI_AGENT_SCAN_CONFIG.queries.length,
        subredditCount: DEFAULT_AI_AGENT_SCAN_CONFIG.subreddits.length,
        queries: DEFAULT_AI_AGENT_SCAN_CONFIG.queries,
        subreddits: DEFAULT_AI_AGENT_SCAN_CONFIG.subreddits,
      },
    });
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new RedditApiHandler(ctx);
}
