import { createAppLogger, type RomeAppApiHandler, type RomeAppApiRequest, type RomeAppContext } from "@rome-os/app-runtime";
import { MAX_REQUEST_BYTES, TikHubConfigError } from "../lib/client.js";
import { AppError, errorText, msg, render, toLang, type Lang } from "../lib/messages.js";
import { readGuardianLang } from "../lib/runtime.js";
import { TikHubService, type SettingsPatch } from "../lib/service.js";

const log = createAppLogger("tikhub:api");

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type Body<T> = { ok: true; value: T } | { ok: false; reason: "empty" | "parse_error" };

function readJsonBody<T>(request: RomeAppApiRequest): Body<T> {
  if (!request.body || request.body.byteLength === 0) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(request.body)) as T };
  } catch {
    return { ok: false, reason: "parse_error" };
  }
}

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? n : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The page sends the language it is showing; otherwise use Rome's global language. */
const LANG_HEADER = "x-tikhub-lang";

class TikHubApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  private async langFor(request: RomeAppApiRequest): Promise<Lang> {
    const header = Object.entries(request.headers).find(([k]) => k.toLowerCase() === LANG_HEADER)?.[1];
    if (header) return toLang(header);
    return readGuardianLang(this.ctx.repositories);
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    if (request.caller?.kind !== "guardian") return json({ error: "forbidden" }, { status: 403 });
    if ((request.body?.byteLength ?? 0) > MAX_REQUEST_BYTES) return json({ error: "input_too_large" }, { status: 413 });
    const lang = await this.langFor(request);
    try {
      return await this.route(request, new TikHubService(this.ctx.db, fetch, undefined, lang));
    } catch (err) {
      const message = errorText(err, lang);
      if (err instanceof AppError && err.msg.code === "config.requestTooLarge") return json({ error: "input_too_large", message }, { status: 413 });
      if (err instanceof TikHubConfigError) return json({ error: "config", message }, { status: 400 });
      if (err instanceof AppError && err.msg.code === "schema.loadFailed") return json({ error: "upstream_unavailable", message }, { status: 503 });
      log.error("api error", { route: request.path.join("/").slice(0, 120) });
      return json({ error: "internal", message }, { status: 500 });
    }
  }

  private async route(request: RomeAppApiRequest, svc: TikHubService): Promise<Response> {
    const route = request.path.join("/");
    const m = request.method.toUpperCase();
    const isGuardian = request.caller.kind === "guardian";
    {
      // Everything here spends the guardian's credits or reveals account data.
      if (!isGuardian) return json({ error: "forbidden" }, { status: 403 });

      if (m === "GET" && route === "status") {
        const settings = svc.publicSettings();
        return json({ appId: this.ctx.app.id, version: this.ctx.app.version, settings });
      }

      if (route === "settings") {
        if (m === "GET") return json(svc.publicSettings());
        if (m === "PUT" || m === "POST") {
          const body = readJsonBody<SettingsPatch>(request);
          if (!body.ok || !isRecord(body.value)) return json({ error: "invalid_json" }, { status: 400 });
          const v = body.value;
          if ("apiKey" in v && v.apiKey !== null && typeof v.apiKey !== "string") return json({ error: "invalid_key_input" }, { status: 400 });
          const patch: SettingsPatch = {};
          if ("apiKey" in v) patch.apiKey = typeof v.apiKey === "string" ? v.apiKey : null;
          if (typeof v.baseUrl === "string") patch.baseUrl = v.baseUrl;
          if (v.timeoutMs !== undefined) patch.timeoutMs = Number(v.timeoutMs);
          if (v.maxRetries !== undefined) patch.maxRetries = Number(v.maxRetries);
          if (v.qps !== undefined) patch.qps = Number(v.qps);
          return json(svc.updateSettings(patch));
        }
      }

      if (m === "POST" && route === "settings/test") {
        const health = await svc.health();
        const settings = svc.publicSettings();
        if (!settings.configured) return json({ health, account: null, message: "No API key configured" });
        const account = await svc.account();
        return json({ health, account: { ok: account.ok, error: account.error, email: account.user?.email ?? null, balance: account.user?.balance ?? null } });
      }

      if (m === "GET" && route === "health") return json(await svc.health());

      if (m === "GET" && route === "account") {
        if (!svc.publicSettings().configured) return json({ configured: false });
        return json({ configured: true, ...(await svc.account()) });
      }

      if (m === "GET" && route === "stats") {
        return json(svc.stats(num(request.query.get("days"), 7), num(request.query.get("tz"), 0)));
      }

      if (m === "GET" && route === "catalog") return json(await svc.catalogInfo());
      if (m === "POST" && route === "catalog/refresh") return json(await svc.refreshCatalog());

      if (m === "GET" && route === "endpoints") {
        const q = request.query;
        const res = await svc.search({
          query: q.get("q") ?? "",
          platform: q.get("platform"),
          tag: q.get("tag"),
          method: q.get("method"),
          limit: num(q.get("limit"), 50),
          offset: num(q.get("offset"), 0),
        });
        return json(res);
      }

      if (m === "GET" && route === "endpoint") {
        const path = request.query.get("path");
        if (!path) return json({ error: "path_required" }, { status: 400 });
        const res = await svc.inspect({ path, method: request.query.get("method") ?? undefined });
        return json(res, { status: "error" in res ? 404 : 200 });
      }

      if (m === "POST" && route === "call") {
        const body = readJsonBody<Record<string, unknown>>(request);
        if (!body.ok || !isRecord(body.value)) return json({ error: "invalid_json" }, { status: 400 });
        const v = body.value;
        if (typeof v.path !== "string") return json({ error: "path_required" }, { status: 400 });
        const out = await svc.call(
          {
            path: v.path,
            method: typeof v.method === "string" ? v.method : undefined,
            query: isRecord(v.query) ? v.query : undefined,
            pathParams: isRecord(v.pathParams) ? v.pathParams : undefined,
            body: v.body,
            confirm: v.confirm === true,
            dryRun: v.dryRun === true,
            maxChars: 200_000,
          },
          "ui",
        );
        return json(out);
      }

      if (m === "GET" && route === "calls") {
        const q = request.query;
        return json(
          svc.listCalls({
            status: q.get("status"),
            platform: q.get("platform"),
            source: q.get("source"),
            q: q.get("q"),
            limit: num(q.get("limit"), 50),
            offset: num(q.get("offset"), 0),
          }),
        );
      }

      if (m === "GET" && request.path[0] === "calls" && request.path.length === 2) {
        const row = svc.getCall(request.path[1]!);
        return row ? json(row) : json({ error: "not_found" }, { status: 404 });
      }

      return json({ error: "not_found", message: render(msg("api.notFound"), svc.lang) }, { status: 404 });
    }
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new TikHubApiHandler(ctx);
}
