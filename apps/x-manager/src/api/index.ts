import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createAppLogger } from "@rome-os/app-runtime";
import type { XRepository } from "../db/repositories/repo.js";

const log = createAppLogger("x_api");

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

async function loadRepository(ctx: RomeAppContext): Promise<XRepository> {
  const modUrl = new URL("../db/repositories/repo.js", import.meta.url);
  const mod = await import(`${modUrl.href}?v=${Date.now()}`);
  return mod.createXRepository(ctx.db);
}

class XApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");
    const repo = await loadRepository(this.ctx);

    // --- App info ---
    if (request.method === "GET" && request.path.length === 0) {
      return json({
        appId: this.ctx.app.id,
        version: this.ctx.app.version,
        status: "ok",
      });
    }

    // --- Dashboard ---
    if (request.method === "GET" && route === "dashboard") {
      const accountState = repo.getAccountState() ?? null;
      const brandVoices = repo.listBrandVoices();
      const recentRuns = repo.listActionRuns(20, 0);
      const totalRuns = repo.countActionRuns();

      return json({
        accountState,
        brandVoices,
        recentRuns,
        stats: {
          totalRuns,
          totalBrandVoices: brandVoices.length,
          ownBrandVoices: brandVoices.filter((v) => v.isOwn === 1).length,
          referenceBrandVoices: brandVoices.filter((v) => v.isOwn === 0).length,
        },
      });
    }

    // --- Action History (paginated) ---
    if (request.method === "GET" && route === "action-runs") {
      const limitParam = parseInt(request.query.get("limit") || "20", 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
      const offsetParam = parseInt(request.query.get("offset") || "0", 10);
      const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
      const actionName = request.query.get("actionName") || undefined;

      const runs = actionName
        ? repo.listActionRunsByName(actionName, limit, offset)
        : repo.listActionRuns(limit, offset);
      const total = repo.countActionRuns();

      return json({ runs, total, limit, offset, hasMore: offset + runs.length < total });
    }

    // --- Account State ---
    if (request.method === "GET" && route === "account") {
      const accountState = repo.getAccountState() ?? null;
      return json({ accountState });
    }

    // --- Trigger Check Login ---
    if (request.method === "POST" && route === "check-login") {
      void this.ctx.runAction("x_check_login", {}).catch((err) =>
        log.error("check-login trigger failed", { error: String(err) }),
      );
      return json({ queued: true }, { status: 202 });
    }

    // --- Brand Voices ---
    if (request.method === "GET" && route === "brand-voices") {
      const brandVoices = repo.listBrandVoices();
      return json({ brandVoices });
    }

    // Trigger learn brand voice
    if (request.method === "POST" && route === "brand-voices/learn") {
      const body = readJson(request);
      const username = (body.username || "").trim();
      const isOwn = body.isOwn !== undefined ? Boolean(body.isOwn) : !username;

      void this.ctx.runAction("x_learn_brand_voice", {
        ...(username ? { username } : {}),
        isOwn,
      }).catch((err) =>
        log.error("learn-brand-voice trigger failed", { error: String(err) }),
      );

      return json({ queued: true, username: username || "(self)" }, { status: 202 });
    }

    // Add a reference brand voice (learn from another account)
    if (request.method === "POST" && route === "brand-voices/add-reference") {
      const body = readJson(request);
      const username = (body.username || "").trim().replace(/^@/, "");
      if (!username) {
        return json({ error: "username is required" }, { status: 400 });
      }

      // Create initial brand voice record, then trigger learning
      repo.upsertBrandVoice({
        accountHandle: username,
        isOwn: false,
        learnStatus: "idle",
        learnProgress: 0,
      });

      void this.ctx.runAction("x_learn_brand_voice", {
        username,
        isOwn: false,
      }).catch((err) =>
        log.error("learn-brand-voice (reference) trigger failed", { error: String(err) }),
      );

      return json({ queued: true, username }, { status: 202 });
    }

    // Delete a brand voice
    if (
      request.method === "DELETE" &&
      request.path.length === 2 &&
      request.path[0] === "brand-voices"
    ) {
      const id = request.path[1];
      repo.deleteBrandVoice(id);
      return json({ ok: true });
    }

    return json(
      { error: "not_found", message: `Unknown route: /${route}` },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new XApiHandler(ctx);
}
