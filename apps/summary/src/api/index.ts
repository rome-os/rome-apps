import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createReportsRepository } from "../db/repositories/reports.js";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readJsonBody(request: RomeAppApiRequest): unknown {
  if (!request.body || request.body.byteLength === 0) return null;
  const text = new TextDecoder().decode(request.body);
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

class SummaryApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");

    // GET / — app metadata
    if (request.method === "GET" && request.path.length === 0) {
      return json({
        appId: this.ctx.app.id,
        version: this.ctx.app.version,
        status: "ok",
      });
    }

    // POST /generate — generate a work summary report
    if (request.method === "POST" && route === "generate") {
      const payload = readJsonBody(request);
      if (payload === undefined) {
        return json({ error: "invalid_json" }, { status: 400 });
      }
      const {
        period = "last-day",
        sendToWechat = false,
        wechatThreadId,
        githubRepos,
      } = (payload ?? {}) as {
        period?: string;
        sendToWechat?: boolean;
        wechatThreadId?: string;
        githubRepos?: string;
      };

      const validPeriods = ["last-day", "last-week", "this-week", "last-month"];
      if (!validPeriods.includes(period)) {
        return json(
          { error: "invalid_period", valid: validPeriods },
          { status: 400 },
        );
      }

      try {
        const result = await this.ctx.runAction("summary_generate_summary", {
          period,
          sendToWechat,
          wechatThreadId,
          githubRepos,
        });
        return json(result);
      } catch (err) {
        return json(
          {
            error: "generation_failed",
            message: (err as Error).message,
          },
          { status: 500 },
        );
      }
    }

    // GET /reports — list all saved reports
    if (request.method === "GET" && route === "reports") {
      try {
        const repo = createReportsRepository(this.ctx.db);
        const reports = await repo.list();
        return json({ success: true, data: reports });
      } catch (err) {
        return json(
          { error: "list_failed", message: (err as Error).message },
          { status: 500 },
        );
      }
    }

    // GET /reports/<id> — get a single report with raw sources
    if (
      request.method === "GET" &&
      request.path.length === 2 &&
      request.path[0] === "reports"
    ) {
      const reportId = request.path[1];
      try {
        const repo = createReportsRepository(this.ctx.db);
        const report = await repo.getById(reportId);
        if (!report) {
          return json({ error: "not_found" }, { status: 404 });
        }
        return json({ success: true, data: report });
      } catch (err) {
        return json(
          { error: "get_failed", message: (err as Error).message },
          { status: 500 },
        );
      }
    }

    return json(
      {
        error: "not_found",
        appId: this.ctx.app.id,
        message: `Unknown Summary API route: /${route}`,
      },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new SummaryApiHandler(ctx);
}
