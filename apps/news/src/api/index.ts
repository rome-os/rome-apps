import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createRedditPostsRepository } from "../db/repositories/reddit-posts.js";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "200", 10);
  if (!Number.isFinite(parsed)) {
    return 200;
  }
  return Math.max(1, Math.min(parsed, 500));
}

class NewsApiHandler implements RomeAppApiHandler {
  private readonly repo;

  constructor(private readonly ctx: RomeAppContext) {
    this.repo = createRedditPostsRepository(ctx.db);
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

    if (request.method === "GET" && route === "reddit-posts") {
      return this.getRedditPosts(request);
    }

    return json(
      {
        error: "not_found",
        appId: this.ctx.app.id,
        message: `Unknown News app API route: /${route}`,
      },
      { status: 404 },
    );
  }

  private async getRedditPosts(request: RomeAppApiRequest): Promise<Response> {
    const subreddit = request.query.get("subreddit")?.trim() || undefined;
    const scanName = request.query.get("scanName")?.trim() || undefined;
    const since = request.query.get("since");
    const search = request.query.get("search")?.trim() || undefined;
    const limit = parseLimit(request.query.get("limit"));
    const sinceDate = since ? new Date(since) : undefined;

    const [posts, subreddits, scanNames, total, today] = await Promise.all([
      this.repo.findAll({
        subreddit,
        scanName,
        since: sinceDate,
        search,
        limit,
      }),
      this.repo.getSubreddits(),
      this.repo.getScanNames(),
      this.repo.count(),
      this.repo.countSince(new Date(new Date().setHours(0, 0, 0, 0))),
    ]);

    return json({
      posts,
      subreddits,
      scanNames,
      stats: {
        total,
        today,
      },
    });
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new NewsApiHandler(ctx);
}
