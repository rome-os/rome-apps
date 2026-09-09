import type {
  ActionResult,
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readJsonBody(request: RomeAppApiRequest): unknown {
  if (!request.body || request.body.byteLength === 0) return null;
  const text = new TextDecoder().decode(request.body);
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // signal malformed JSON
  }
}

function actionResponse(result: ActionResult): Response {
  if (result.status === "ok") return json(result.data ?? {});
  const error =
    result.status === "error"
      ? result.error
      : `action returned ${result.status}`;
  return json({ error }, { status: 400 });
}

class YtDistillApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");
    // The Rome host resolves the caller before we see the request. "guardian" is
    // the instance owner (dashboard session or in-container agent). Everyone else
    // (public internet visitors on the public URL) is "anonymous"/"visitor".
    const isOwner = request.caller.kind === "guardian";
    const forbidden = () =>
      json(
        { error: "forbidden", message: "This action is only available to the app owner." },
        { status: 403 },
      );

    // GET / — health/status
    if (request.method === "GET" && request.path.length === 0) {
      return json({ appId: this.ctx.app.id, version: this.ctx.app.version, status: "ok" });
    }

    // GET /me — who is viewing (lets the UI show owner controls vs. read-only)
    if (request.method === "GET" && route === "me") {
      return json({ kind: request.caller.kind, owner: isOwner });
    }

    // GET /list — owner sees everything; anyone else sees only public samples
    if (request.method === "GET" && route === "list") {
      const result = await this.ctx.runAction("yt-distill:list", {
        scope: isOwner ? "all" : "featured",
      });
      return actionResponse(result);
    }

    // GET /item/:id — full record; non-owners can only open public samples
    if (request.method === "GET" && request.path[0] === "item" && request.path.length === 2) {
      const result = await this.ctx.runAction("yt-distill:get", {
        id: request.path[1],
        publicOnly: !isOwner,
      });
      if (result.status === "error") return json({ error: result.error }, { status: 404 });
      return actionResponse(result);
    }

    // POST /distill — OWNER ONLY (runs on the owner's browser session + compute)
    if (request.method === "POST" && route === "distill") {
      if (!isOwner) return forbidden();
      const payload = readJsonBody(request);
      if (payload === undefined) return json({ error: "invalid_json" }, { status: 400 });
      const { url, types, style, recordId, reuseTranscript } = (payload ?? {}) as {
        url?: unknown;
        types?: unknown;
        style?: unknown;
        recordId?: unknown;
        reuseTranscript?: unknown;
      };
      const hasRecord = typeof recordId === "string" && recordId.length > 0;
      if (!hasRecord && (typeof url !== "string" || !url.trim())) {
        return json({ error: "url_required" }, { status: 400 });
      }
      // A fresh video (scrape + generation) can take minutes: return the record
      // id right away and let the page poll `get` until it is ready. Adding to
      // an existing record only runs the model step, so it stays synchronous.
      const result = await this.ctx.runAction("yt-distill:distill", {
        ...(hasRecord ? { recordId } : { url, background: true }),
        types,
        style,
        ...(reuseTranscript === false ? { reuseTranscript: false } : {}),
      });
      return actionResponse(result);
    }

    // POST /feature — OWNER ONLY: mark/unmark a record as a public sample
    if (request.method === "POST" && route === "feature") {
      if (!isOwner) return forbidden();
      const payload = readJsonBody(request);
      if (payload === undefined) return json({ error: "invalid_json" }, { status: 400 });
      const { id, featured } = (payload ?? {}) as { id?: unknown; featured?: unknown };
      if (typeof id !== "string" || !id) return json({ error: "id_required" }, { status: 400 });
      const result = await this.ctx.runAction("yt-distill:set_featured", {
        id,
        featured: featured === true,
      });
      if (result.status === "error") return json({ error: result.error }, { status: 404 });
      return actionResponse(result);
    }

    // DELETE /item/:id — OWNER ONLY
    if (request.method === "DELETE" && request.path[0] === "item" && request.path.length === 2) {
      if (!isOwner) return forbidden();
      const result = await this.ctx.runAction("yt-distill:remove", { id: request.path[1] });
      if (result.status === "error") return json({ error: result.error }, { status: 404 });
      return actionResponse(result);
    }

    return json(
      { error: "not_found", appId: this.ctx.app.id, message: `Unknown route: /${route}` },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new YtDistillApiHandler(ctx);
}
