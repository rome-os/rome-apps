/**
 * TikHubService — the single orchestration layer shared by actions and the
 * HTTP API. Owns settings, schema/price caches, the call pipeline and logging.
 */
import { createAppLogger, type AppDbContext } from "@rome-os/app-runtime";
import { createRepositories, type CallListFilter, type Repositories } from "../db/repositories/index.js";
import { DispatchQueueError, dispatchWhenReady, MAX_QUEUE_MS, systemDispatchClock, type DispatchClock } from "./dispatch.js";
import { pickSlash } from "./i18n.js";
import { AppError, legacyTextToMsg, msg, parseMsg, render, type Lang, type Msg } from "./messages.js";
import {
  CHINA_BASE_URL,
  DEFAULT_BASE_URL,
  TikHubConfigError,
  buildUrl,
  substitutePathParams,
  tikhubRequest,
  type ClientOptions,
  type TikHubResponse,
} from "./client.js";
import {
  buildOperationIndex,
  inspectOperation,
  isHttpMethod,
  methodsForPath,
  parsePriceList,
  searchOperations,
  type EndpointPrice,
  type OpenApiDoc,
  type OperationDetail,
  type OperationSummary,
  type SearchOptions,
} from "./openapi.js";
import { PLATFORMS, platformForTag } from "./platforms.js";
import { assessSafety, isPrivateField, maskApiKey, redactSecrets, safetyView, suppliedFieldNames, scrubText } from "./safety.js";
import { assertInputBounds, validateRequest } from "./validation.js";
import { isAllowedPublicRead } from "./public-reads.js";
import { previewText, shapeCallPayload, truncateForAgent, unwrapEnvelope } from "./shape.js";

const log = createAppLogger("tikhub:service");

export const SCHEMA_TTL_MS = 24 * 60 * 60 * 1000;
export const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const SCHEMA_CACHE_KEY = "openapi";
const PRICE_CACHE_KEY = "prices";

export interface TikHubSettings {
  apiKey: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  qps: number;
}

export const DEFAULT_SETTINGS: Omit<TikHubSettings, "apiKey"> = {
  baseUrl: DEFAULT_BASE_URL,
  timeoutMs: 45_000,
  maxRetries: 3,
  qps: 8,
};

export interface PublicSettings {
  configured: boolean;
  apiKeyMasked: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  qps: number;
  baseUrlOptions: Array<{ value: string; label: string }>;
}

export interface SettingsPatch {
  apiKey?: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  qps?: number;
}

export type CallSource = "agent" | "ui";

export interface CallInput {
  method?: string;
  path: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  confirm?: boolean;
  dryRun?: boolean;
  /** Serialized JSON budget for data + pagination; other call metadata is additional. */
  maxChars?: number;
}

export interface CallOutcome {
  callId: string;
  status: "ok" | "error" | "blocked" | "dry_run";
  outcomeUnknown?: boolean;
  costBasis?: "base_estimate" | "not_billed" | "unknown";
  method: string;
  path: string;
  platform: string | null;
  tag: string | null;
  httpStatus?: number;
  durationMs?: number;
  attempts?: number;
  requestId?: string | null;
  costUsd?: number | null;
  error?: string;
  safety?: { sensitive: boolean; reasons: string[] };
  warnings: string[];
  pagination?: Record<string, unknown> | null;
  paginationOmitted?: boolean;
  data?: unknown;
  truncated?: boolean;
  originalChars?: number;
  request?: { url: string; body?: unknown };
}

interface SchemaState {
  doc: OpenApiDoc;
  index: OperationSummary[];
  fetchedAt: Date;
  version: string | null;
}

interface PriceState {
  prices: Record<string, EndpointPrice>;
  fetchedAt: Date;
}

// Per-process memo keyed by table prefix; DB cache is the durable source.
const schemaMemo = new Map<string, SchemaState>();
const priceMemo = new Map<string, PriceState>();

const ALLOWED_ORIGINS = new Set([DEFAULT_BASE_URL, CHINA_BASE_URL]);

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TikHubConfigError(msg("config.badUrl"));
  }
  if (url.protocol !== "https:") throw new TikHubConfigError(msg("config.httpsOnly"));
  // Keep the API key from being sent anywhere except TikHub.
  if (!ALLOWED_ORIGINS.has(url.origin) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
    throw new TikHubConfigError(msg("config.hostNotAllowed"));
  }
  return url.origin;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Accept "/api/…", "api/…", or a full https://api.tikhub.io/api/… URL; split any ?query. */
export function normalizeEndpointPath(input: string): { path: string; query: Record<string, string> } {
  let raw = input.trim();
  if (raw.length > 4096 || /[\\#\u0000-\u0020\u007f]/.test(raw)) throw new TikHubConfigError(msg("config.badPath"));
  let query: Record<string, string> = {};
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    normalizeBaseUrl(u.origin);
    if (u.username || u.password) throw new TikHubConfigError(msg("config.badPath"));
    // Preserve the raw path for validation: URL.pathname normalizes dot segments.
    raw = raw.replace(/^https?:\/\/[^/?#]+/i, "") || "/";
  }
  const qi = raw.indexOf("?");
  if (qi >= 0) {
    query = Object.fromEntries(new URLSearchParams(raw.slice(qi + 1)));
    raw = raw.slice(0, qi);
  }
  if (!raw.startsWith("/")) raw = `/${raw}`;
  if (!/^\/[A-Za-z0-9_{}./-]+$/.test(raw) || raw.includes("//") || raw.split("/").some((s) => s === "." || s === "..")) {
    throw new TikHubConfigError(msg("config.badPath"));
  }
  return { path: raw.replace(/\/+$/, "") || "/", query };
}

export class TikHubService {
  readonly repos: Repositories;
  private readonly memoKey: string;

  constructor(
    db: AppDbContext,
    private readonly fetchImpl: typeof fetch = fetch,
    repos?: Repositories,
    /** The one language every person-facing string is rendered in (Rome's global language). */
    readonly lang: Lang = "en",
    private readonly dispatchClock: DispatchClock = systemDispatchClock,
  ) {
    this.repos = repos ?? createRepositories(db);
    this.memoKey = db.tablePrefix;
  }

  private t(m: Msg): string {
    return render(m, this.lang);
  }

  /** Stored call-log error → current language (structured JSON, or legacy text). */
  private localizeError(row: { errorJson?: string | null; errorMessage: string | null }): string | null {
    const m = parseMsg(row.errorJson) ?? (row.errorMessage ? legacyTextToMsg(row.errorMessage) : null);
    if (m) return m.code === "net.error" ? this.t(msg("net.unknown")) : this.t({ ...m, upstream: undefined });
    return row.errorMessage ? this.t(msg("common.internal")) : null;
  }

  // ── settings ────────────────────────────────────────────────────────────

  getSettings(): TikHubSettings {
    const raw = this.repos.settings.getAll();
    let baseUrl = DEFAULT_SETTINGS.baseUrl;
    try {
      if (raw.baseUrl) baseUrl = normalizeBaseUrl(raw.baseUrl);
    } catch {
      /* fall back to default */
    }
    return {
      apiKey: raw.apiKey?.trim() || null,
      baseUrl,
      timeoutMs: clampInt(raw.timeoutMs, 5_000, 120_000, DEFAULT_SETTINGS.timeoutMs),
      maxRetries: clampInt(raw.maxRetries, 0, 5, DEFAULT_SETTINGS.maxRetries),
      qps: clampInt(raw.qps, 1, 10, DEFAULT_SETTINGS.qps),
    };
  }

  publicSettings(): PublicSettings {
    const s = this.getSettings();
    return {
      configured: !!s.apiKey,
      apiKeyMasked: maskApiKey(s.apiKey),
      baseUrl: s.baseUrl,
      timeoutMs: s.timeoutMs,
      maxRetries: s.maxRetries,
      qps: s.qps,
      baseUrlOptions: [
        { value: DEFAULT_BASE_URL, label: "api.tikhub.io" },
        { value: CHINA_BASE_URL, label: "api.tikhub.dev" },
      ],
    };
  }

  updateSettings(patch: SettingsPatch): PublicSettings {
    // Validate the whole fallible part before replacing any existing key.
    const baseUrl = patch.baseUrl !== undefined ? normalizeBaseUrl(patch.baseUrl) : undefined;
    if (patch.apiKey !== undefined) {
      const key = (patch.apiKey ?? "").trim().replace(/^Bearer\s+/i, "");
      if (!key) this.repos.settings.delete("apiKey");
      else {
        if (/\s/.test(key) || key.length < 16) throw new TikHubConfigError(msg("config.badKey"));
        this.repos.settings.set("apiKey", key);
      }
    }
    if (baseUrl !== undefined) this.repos.settings.set("baseUrl", baseUrl);
    if (patch.timeoutMs !== undefined) this.repos.settings.set("timeoutMs", String(clampInt(patch.timeoutMs, 5_000, 120_000, DEFAULT_SETTINGS.timeoutMs)));
    if (patch.maxRetries !== undefined) this.repos.settings.set("maxRetries", String(clampInt(patch.maxRetries, 0, 5, DEFAULT_SETTINGS.maxRetries)));
    if (patch.qps !== undefined) this.repos.settings.set("qps", String(clampInt(patch.qps, 1, 10, DEFAULT_SETTINGS.qps)));
    return this.publicSettings();
  }

  private clientOptions(path: string, endpointQps = 1): ClientOptions {
    const s = this.getSettings();
    return { ...s, fetchImpl: this.fetchImpl, beginRequest: () => {
      try {
        const lease = this.repos.cache.acquireRequestLease(MAX_QUEUE_MS + Math.max(s.timeoutMs, 60_000) + 5_000, this.dispatchClock.now());
        return () => this.repos.cache.releaseRequestLease(lease);
      } catch { throw new TikHubConfigError(msg("config.busy")); }
    }, dispatch: send => dispatchWhenReady(() => {
      try { return this.repos.cache.tryAcquireRequestSlot(path, s.qps, endpointQps, this.dispatchClock.now()); }
      catch { throw new TikHubConfigError(msg("config.busy")); }
    }, send, this.dispatchClock).catch(error => {
      // Keep local queue errors localized. Sent fetch failures pass through;
      // the client distinguishes them by whether its send callback ran.
      if (error instanceof DispatchQueueError) throw new TikHubConfigError(msg("config.busy"));
      throw error;
    }) };
  }

  // ── schema & prices ─────────────────────────────────────────────────────

  async getSchema(opts: { refresh?: boolean } = {}): Promise<SchemaState> {
    const memo = schemaMemo.get(this.memoKey);
    const fresh = (d: Date) => Date.now() - d.getTime() < SCHEMA_TTL_MS;
    if (!opts.refresh && memo && fresh(memo.fetchedAt)) return memo;

    const cached = opts.refresh ? null : this.repos.cache.get(SCHEMA_CACHE_KEY);
    if (cached && fresh(cached.fetchedAt)) {
      const state = this.hydrateSchema(cached.value, cached.fetchedAt);
      if (state) return state;
    }

    const res = await tikhubRequest({ ...this.clientOptions("/openapi.json"), maxRetries: Math.min(this.getSettings().maxRetries, 2), timeoutMs: 60_000 }, {
      method: "GET",
      path: "/openapi.json",
      anonymous: true,
    });
    if (res.ok && res.payload && typeof res.payload === "object" && "paths" in (res.payload as object)) {
      const text = JSON.stringify(res.payload);
      this.repos.cache.set(SCHEMA_CACHE_KEY, text);
      const state = this.hydrateSchema(text, new Date())!;
      log.info("openapi schema refreshed", { version: state.version, operations: state.index.length });
      return state;
    }
    // Network failure: serve stale data if we have any.
    const stale = memo ?? (() => {
      const c = this.repos.cache.get(SCHEMA_CACHE_KEY);
      return c ? this.hydrateSchema(c.value, c.fetchedAt) : null;
    })();
    if (stale) {
      log.warn("schema refresh failed; serving stale cache", { error: res.errorMessage });
      return stale;
    }
    throw new AppError(msg("schema.loadFailed", { cause: res.error ?? msg("common.unknown") }));
  }

  private hydrateSchema(text: string, fetchedAt: Date): SchemaState | null {
    try {
      const doc = JSON.parse(text) as OpenApiDoc;
      const state: SchemaState = { doc, index: buildOperationIndex(doc), fetchedAt, version: doc.info?.version ?? null };
      schemaMemo.set(this.memoKey, state);
      return state;
    } catch {
      return null;
    }
  }

  async getPrices(opts: { refresh?: boolean } = {}): Promise<PriceState | null> {
    const memo = priceMemo.get(this.memoKey);
    const fresh = (d: Date) => Date.now() - d.getTime() < PRICE_TTL_MS;
    if (!opts.refresh && memo && fresh(memo.fetchedAt)) return memo;
    const cached = opts.refresh ? null : this.repos.cache.get(PRICE_CACHE_KEY);
    if (cached && fresh(cached.fetchedAt)) {
      const state = { prices: JSON.parse(cached.value) as Record<string, EndpointPrice>, fetchedAt: cached.fetchedAt };
      priceMemo.set(this.memoKey, state);
      return state;
    }
    // Public endpoint: pricing is readable without an API key.
    const res = await tikhubRequest({ ...this.clientOptions("/api/v1/tikhub/user/get_all_endpoints_info"), maxRetries: Math.min(this.getSettings().maxRetries, 1), timeoutMs: 30_000 }, {
      method: "GET",
      path: "/api/v1/tikhub/user/get_all_endpoints_info",
      anonymous: true,
    });
    if (res.ok) {
      const prices = parsePriceList(unwrapEnvelope(res.payload).data);
      if (Object.keys(prices).length > 0) {
        this.repos.cache.set(PRICE_CACHE_KEY, JSON.stringify(prices));
        const state = { prices, fetchedAt: new Date() };
        priceMemo.set(this.memoKey, state);
        return state;
      }
    }
    log.warn("price list refresh failed", { error: res.errorMessage });
    if (memo) return memo;
    const stale = this.repos.cache.get(PRICE_CACHE_KEY);
    return stale ? { prices: JSON.parse(stale.value), fetchedAt: stale.fetchedAt } : null;
  }

  private async priceFor(path: string): Promise<EndpointPrice | null> {
    try {
      return (await this.getPrices())?.prices[path] ?? null;
    } catch {
      return null;
    }
  }

  async catalogInfo() {
    const schema = await this.getSchema();
    const prices = await this.getPrices().catch(() => null);
    const counts = new Map<string, number>();
    for (const op of schema.index) for (const t of op.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return {
      version: schema.version,
      fetchedAt: schema.fetchedAt.toISOString(),
      operations: schema.index.length,
      pricesFetchedAt: prices?.fetchedAt.toISOString() ?? null,
      platforms: PLATFORMS.map((p) => ({
        id: p.id,
        label: this.lang === "zh" ? p.label : p.labelEn,
        note: (this.lang === "zh" ? p.note : p.noteEn) ?? null,
        tags: p.tags.filter((t) => counts.has(t)).map((t) => ({ tag: t, operations: counts.get(t)! })),
        operations: p.tags.reduce((n, t) => n + (counts.get(t) ?? 0), 0),
      })),
    };
  }

  async refreshCatalog() {
    await this.getSchema({ refresh: true });
    await this.getPrices({ refresh: true });
    return this.catalogInfo();
  }

  // ── discovery ───────────────────────────────────────────────────────────

  async search(opts: SearchOptions) {
    const schema = await this.getSchema();
    const result = searchOperations(schema.index, opts);
    const prices = await this.getPrices().catch(() => null);
    return {
      ...result,
      schemaVersion: schema.version,
      items: result.items.map((op) => ({
        ...op,
        costUsd: prices?.prices[op.path]?.costUsd ?? null,
        summary: pickSlash(op.summary, this.lang),
        brief: this.lang === "zh" ? op.briefZh || op.brief : op.brief,
        guarded: assessSafety({ path: op.path, method: op.method, operationId: op.operationId, allowed: isAllowedPublicRead(op.method, op.path), deprecated: schema.doc.paths[op.path]?.[op.method]?.deprecated === true }).sensitive,
      })),
    };
  }

  async inspect(input: { path: string; method?: string }): Promise<
    | (OperationDetail & { price: EndpointPrice | null; safety: { sensitive: boolean; reasons: string[] }; example: { query?: Record<string, unknown>; body?: Record<string, unknown> } })
    | { error: string; suggestions?: Array<{ method: string; path: string; summary: string }> }
  > {
    const { path } = normalizeEndpointPath(input.path);
    const schema = await this.getSchema();
    const methods = methodsForPath(schema.doc, path);
    if (methods.length === 0) {
      const near = searchOperations(schema.index, { query: path.split("/").slice(-1)[0]!.replace(/_/g, " "), limit: 5 });
      return {
        error: this.t(msg("inspect.notFound", { version: schema.version ?? "", path })),
        suggestions: near.items.map((o) => ({ method: o.method.toUpperCase(), path: o.path, summary: pickSlash(o.summary, this.lang) })),
      };
    }
    const method = input.method && isHttpMethod(input.method) ? input.method.toLowerCase() : methods[0]!;
    if (!methods.includes(method as never)) {
      const avail = methods.map((m) => m.toUpperCase()).join(", ");
      return { error: this.t(msg("inspect.methodNotDefined", { path, method: method.toUpperCase(), available: avail })) };
    }
    const detail = inspectOperation(schema.doc, method, path)!;
    const price = await this.priceFor(path);
    const safety = safetyView(assessSafety({ path, method, operationId: detail.operationId, summary: detail.summary, requiredFields: detail.requiredFields, deprecated: schema.doc.paths[path]?.[method]?.deprecated === true, allowed: isAllowedPublicRead(method, path) }), this.lang);
    const example: { query?: Record<string, unknown>; body?: Record<string, unknown> } = {};
    const q = Object.fromEntries(detail.parameters.filter((p) => !isPrivateField(p.name) && (p.example !== undefined || p.required)).map((p) => [p.name, p.example ?? p.default ?? ""]));
    if (Object.keys(q).length) example.query = q;
    if (detail.body) {
      example.body =
        detail.body.example && typeof detail.body.example === "object"
          ? (detail.body.example as Record<string, unknown>)
          : Object.fromEntries(detail.body.fields.map((f) => [f.name, f.example ?? f.default ?? ""]));
      example.body = omitPrivateExamples(example.body);
    }
    // Upstream docs are bilingual; hand out only the current language.
    const localized = {
      ...detail,
      summary: pickSlash(detail.summary, this.lang),
      brief: this.lang === "zh" ? detail.briefZh || detail.brief : detail.brief,
      parameters: detail.parameters.map((p) => ({ ...p, description: pickSlash(p.description, this.lang) })),
      body: detail.body
        ? { ...detail.body, fields: detail.body.fields.map((f) => ({ ...f, description: pickSlash(f.description, this.lang) })) }
        : null,
    };
    return { ...localized, price, safety, example };
  }

  // ── calling ─────────────────────────────────────────────────────────────

  async call(input: CallInput, source: CallSource): Promise<CallOutcome> {
    assertInputBounds(input);
    const warnings: string[] = [];
    const norm = normalizeEndpointPath(input.path);
    const query: Record<string, unknown> = { ...norm.query, ...(input.query ?? {}) };
    const pathParams: Record<string, unknown> = { ...(input.pathParams ?? {}) };
    let path = norm.path;
    if (!path.startsWith("/api/")) throw new TikHubConfigError(msg("config.pathPrefix", { path }));

    const schema = await this.getSchema();
    if (Date.now() - schema.fetchedAt.getTime() >= SCHEMA_TTL_MS) throw new TikHubConfigError(msg("config.staleSchema"));
    const methods = methodsForPath(schema.doc, path);
    const selectedMethod = input.method?.toLowerCase() ?? methods[0];
    if (!selectedMethod || !isHttpMethod(selectedMethod) || !methods.includes(selectedMethod as never)) {
      throw new TikHubConfigError(msg("config.undocumented"));
    }
    const op = inspectOperation(schema.doc, selectedMethod, path);
    if (!op) throw new TikHubConfigError(msg("config.undocumented"));
    const method = op.method.toUpperCase();

    // Route declared path params that the caller put in `query`.
    if (op) {
      for (const p of op.parameters.filter((p) => p.in === "path")) {
        if (pathParams[p.name] === undefined && query[p.name] !== undefined) {
          pathParams[p.name] = query[p.name];
          delete query[p.name];
        }
      }
    }

    let body = input.body;
    if (typeof body === "string" && body.trim()) {
      try {
        body = JSON.parse(body);
      } catch {
        throw new TikHubConfigError(msg("config.badBody"));
      }
    }
    // Convenience: POST endpoints whose caller passed fields in `query` only.
    if (op?.body && body === undefined) {
      const bodyNames = new Set(op.body.fields.map((f) => f.name));
      const moved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(query)) if (bodyNames.has(k) && !op.parameters.some((p) => p.name === k)) moved[k] = v;
      if (Object.keys(moved).length) {
        for (const k of Object.keys(moved)) delete query[k];
        body = moved;
        warnings.push(this.t(msg("warn.movedToBody", { fields: Object.keys(moved).join(", ") })));
      }
    }

    assertInputBounds({ query, pathParams, body });
    const suppliedKeys = suppliedFieldNames({ query, pathParams, body });
    const safety = assessSafety({
      path,
      operationId: op?.operationId,
      summary: op?.summary,
      requiredFields: op?.requiredFields,
      suppliedKeys,
      method,
      deprecated: schema.doc.paths[path]?.[selectedMethod]?.deprecated === true,
      allowed: isAllowedPublicRead(selectedMethod, path),
    });

    const tag = op?.tag ?? null;
    const platform = op?.platform ?? platformForTag(tag) ?? guessPlatformFromPath(path);
    const base = { method, path, platform, tag, warnings, safety: safetyView(safety, this.lang) };
    const id = crypto.randomUUID();
    const knownSecrets = [this.getSettings().apiKey].filter((s): s is string => !!s);
    const requestJson = previewText(redactSecrets({ query, pathParams, body }, 0, knownSecrets));
    const record = (status: string, extra: Record<string, unknown> = {}) =>
      this.repos.calls.insert({ id, createdAt: new Date(), finishedAt: new Date(), source, method, path, tag, platform, status,
        requestJson: status === "blocked" || status === "error" ? "{}" : requestJson, costUsd: 0, ...extra });
    // Persist the structured message (re-rendered per language later) plus an English copy for logs.
    const errorFields = (m: Msg) => ({ errorJson: JSON.stringify(m), errorMessage: render(m, "en") });

    // This public-data app does not implement credential/private-account flows.
    // A caller-provided boolean is never evidence of guardian approval.
    if (safety.sensitive) {
      const m = msg("call.blocked", { reasons: safety.codes.map((c) => msg(c)) });
      record("blocked", errorFields(m));
      return { callId: id, status: "blocked", ...base, attempts: 0, costUsd: 0, costBasis: "not_billed", error: this.t(m) };
    }

    {
      const issues = validateRequest(schema.doc, selectedMethod, path, query, pathParams, body);
      if (issues.length) {
        const m = msg("call.invalidParams", { params: issues.join(", ") });
        record("error", errorFields(m));
        return { callId: id, status: "error", ...base, attempts: 0, costUsd: 0, costBasis: "not_billed", error: this.t(m) };
      }
    }

    let resolvedPath: string;
    try {
      resolvedPath = substitutePathParams(path, pathParams);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      record("error", errorFields(err.msg));
      return { callId: id, status: "error", ...base, attempts: 0, costUsd: 0, costBasis: "not_billed", error: this.t(err.msg) };
    }

    const settings = this.getSettings();
    const priceState = await this.getPrices().catch(() => null);
    const price = priceState?.prices[path] ?? null;
    if (input.dryRun) {
      const url = buildUrl(settings.baseUrl, resolvedPath, redactSecrets(query, 0, knownSecrets) as Record<string, unknown>);
      record("dry_run", { costUsd: 0 });
      return {
        callId: id,
        status: "dry_run",
        ...base,
        costUsd: price?.costUsd ?? null,
        request: { url, ...(body !== undefined ? { body: redactSecrets(body, 0, knownSecrets) } : {}) },
      };
    }

    if (!settings.apiKey) throw new TikHubConfigError(msg("config.noKey"));
    if (!priceState || Date.now() - priceState.fetchedAt.getTime() >= PRICE_TTL_MS || price?.costUsd === null || price === null) {
      throw new TikHubConfigError(msg("config.priceUnavailable"));
    }

    this.repos.calls.insert({ id, createdAt: new Date(), source, method, path, tag, platform, status: "pending", requestJson });
    let res: TikHubResponse;
    try {
      const rate = /^(\d+(?:\.\d+)?)(?:\/second)?\s*$/.exec(price?.rateLimit ?? "");
      res = await tikhubRequest(this.clientOptions(path, rate ? Number(rate[1]) : 1), { method, path: resolvedPath, query, body });
    } catch (err) {
      this.repos.calls.update(id, {
        status: "error",
        costUsd: 0,
        attempts: 0,
        finishedAt: new Date(),
        ...(err instanceof AppError ? errorFields(err.msg) : errorFields(msg("common.internal"))),
      });
      throw err;
    }

    const { data } = unwrapEnvelope(res.payload);
    const costUsd = res.outcomeUnknown ? null : res.httpStatus === 200 ? (price?.costUsd ?? null) : 0;
    this.repos.calls.update(id, {
      status: res.outcomeUnknown ? "outcome_unknown" : res.ok ? "ok" : "error",
      finishedAt: new Date(),
      httpStatus: res.httpStatus,
      durationMs: res.durationMs,
      attempts: res.attempts,
      requestId: res.requestId,
      costUsd,
      ...(res.error ? errorFields(res.error) : { errorMessage: null, errorJson: null }),
      responsePreview: previewText(res.ok ? data : res.payload),
      responseBytes: res.bytes,
    });

    if (!res.ok) {
      return {
        callId: id,
        status: "error",
        ...base,
        httpStatus: res.httpStatus,
        durationMs: res.durationMs,
        attempts: res.attempts,
        requestId: res.requestId,
        costUsd,
        outcomeUnknown: res.outcomeUnknown,
        costBasis: costUsd === null ? "unknown" : costUsd === 0 ? "not_billed" : "base_estimate",
        error: this.t(res.error ?? msg("http.other", { status: res.httpStatus })),
      };
    }

    const maxChars = clampInt(input.maxChars, 2_000, 200_000, 30_000);
    const shaped = shapeCallPayload(data, maxChars);
    if (shaped.truncated) {
      warnings.push(this.t(msg("warn.truncated", { from: shaped.originalChars, max: maxChars, callId: id })));
    }
    if (shaped.paginationOmitted) warnings.push(this.t(msg("warn.paginationOmitted")));
    return {
      callId: id,
      status: "ok",
      ...base,
      httpStatus: res.httpStatus,
      durationMs: res.durationMs,
      attempts: res.attempts,
      requestId: res.requestId,
      costUsd,
      costBasis: costUsd === null ? "unknown" : "base_estimate",
      pagination: shaped.pagination,
      paginationOmitted: shaped.paginationOmitted,
      data: shaped.value,
      truncated: shaped.truncated,
      originalChars: shaped.originalChars,
    };
  }

  // ── account ─────────────────────────────────────────────────────────────

  async health() {
    const res = await tikhubRequest({ ...this.clientOptions("/api/v1/health/check"), maxRetries: 0, timeoutMs: 15_000 }, {
      method: "GET",
      path: "/api/v1/health/check",
      anonymous: true,
    });
    return { ok: res.ok, httpStatus: res.httpStatus, latencyMs: res.durationMs, baseUrl: this.getSettings().baseUrl, error: res.error ? this.t(res.error) : null };
  }

  /** Account info + daily usage. These account endpoints are not billed per call. */
  async account() {
    const [info, usage] = await Promise.all([
      tikhubRequest(this.clientOptions("/api/v1/tikhub/user/get_user_info"), { method: "GET", path: "/api/v1/tikhub/user/get_user_info" }),
      tikhubRequest(this.clientOptions("/api/v1/tikhub/user/get_user_daily_usage"), { method: "GET", path: "/api/v1/tikhub/user/get_user_daily_usage" }),
    ]);
    const infoPayload = info.ok ? (info.payload as Record<string, unknown>) : null;
    const userData = (infoPayload?.user_data ?? null) as Record<string, unknown> | null;
    const keyData = (infoPayload?.api_key_data ?? null) as Record<string, unknown> | null;
    if (userData) {
      // Keep PII out of agent context beyond what's needed.
      delete userData.password;
    }
    return {
      ok: info.ok,
      error: info.error ? this.t(info.error) : null,
      user: userData
        ? {
            email: boundedString(userData.email, 320),
            balance: finiteNumber(userData.balance),
            freeCredit: finiteNumber(userData.free_credit),
            emailVerified: typeof userData.email_verified === "boolean" ? userData.email_verified : null,
            accountDisabled: typeof userData.account_disabled === "boolean" ? userData.account_disabled : null,
            isActive: typeof userData.is_active === "boolean" ? userData.is_active : null,
          }
        : null,
      apiKey: keyData
        ? {
            name: boundedString(keyData.api_key_name, 200),
            status: finiteNumber(keyData.api_key_status),
            scopes: Array.isArray(keyData.api_key_scopes) ? keyData.api_key_scopes.filter((s): s is string => typeof s === "string").slice(0, 100).map((s) => s.slice(0, 500)) : null,
            createdAt: boundedString(keyData.created_at, 100),
            expiresAt: boundedString(keyData.expires_at, 100),
          }
        : null,
      dailyUsage: usage.ok ? truncateForAgent(unwrapEnvelope(usage.payload).data ?? usage.payload, 20_000).value : null,
      dailyUsageError: usage.error ? this.t(usage.error) : null,
    };
  }

  // ── log & stats ─────────────────────────────────────────────────────────

  listCalls(filter: CallListFilter) {
    const res = this.repos.calls.list(filter);
    const key = this.getSettings().apiKey;
    return { ...res, items: res.items.map((row) => this.publicCallRow(row, key)) };
  }

  getCall(id: string) {
    const row = this.repos.calls.byId(id);
    if (!row) return null;
    return this.publicCallRow(row, this.getSettings().apiKey);
  }

  private publicCallRow<T extends { errorJson: string | null; errorMessage: string | null; requestJson: string | null; status: string; createdAt: Date; costUsd: number | null; responsePreview?: string | null }>(row: T, key: string | null) {
    const { errorJson, ...rest } = row;
    const secrets = key ? [key] : [];
    const safeJson = (text: string | null | undefined): string | null => {
      if (!text) return null;
      try { return previewText(redactSecrets(JSON.parse(text), 0, secrets)); }
      catch { return this.t(msg("log.withheld")); }
    };
    const interrupted = row.status === "pending" && Date.now() - row.createdAt.getTime() > 10 * 60 * 1000;
    return { ...rest,
      status: interrupted ? "outcome_unknown" : row.status,
      costUsd: interrupted ? null : row.costUsd,
      requestJson: safeJson(row.requestJson),
      ...(row.responsePreview !== undefined ? { responsePreview: safeJson(row.responsePreview) } : {}),
      errorMessage: scrubText(interrupted ? this.t(msg("net.unknown")) : this.localizeError(row) ?? "", secrets) || null,
    };
  }

  /** Local call stats for the last `days` days, bucketed by the caller's UTC offset. */
  stats(days: number, tzOffsetMinutes: number) {
    const d = clampInt(days, 1, 90, 7);
    const offsetMs = clampInt(tzOffsetMinutes, -840, 840, 0) * 60_000;
    const now = Date.now();
    const todayStartLocal = Math.floor((now + offsetMs) / 86_400_000) * 86_400_000 - offsetMs;
    const since = new Date(todayStartLocal - (d - 1) * 86_400_000);
    const rows = this.repos.calls.aggregateSince(since, offsetMs);
    const buckets = Array.from({ length: d }, (_, i) => {
      const start = since.getTime() + i * 86_400_000;
      return { date: new Date(start + offsetMs).toISOString().slice(0, 10), calls: 0, ok: 0, errors: 0, blocked: 0, costUsd: 0, unknownCosts: 0 };
    });
    const byPlatform = new Map<string, { calls: number; costUsd: number }>();
    for (const r of rows) {
      if (r.status === "dry_run") continue;
      const i = r.day - Math.floor((since.getTime() + offsetMs) / 86_400_000);
      const b = buckets[i];
      if (!b) continue;
      b.calls += r.n;
      if (r.status === "ok") b.ok += r.n;
      else if (r.status === "blocked") b.blocked += r.n;
      else if (r.status === "error" || r.status === "outcome_unknown") b.errors += r.n;
      b.unknownCosts += r.unknownCosts;
      b.costUsd += r.costUsd ?? 0;
      const key = r.platform ?? "other";
      const p = byPlatform.get(key) ?? { calls: 0, costUsd: 0 };
      p.calls += r.n;
      p.costUsd += r.costUsd ?? 0;
      byPlatform.set(key, p);
    }
    const totals = buckets.reduce(
      (t, b) => ({ calls: t.calls + b.calls, ok: t.ok + b.ok, errors: t.errors + b.errors, costUsd: t.costUsd + b.costUsd, unknownCosts: t.unknownCosts + b.unknownCosts }),
      { calls: 0, ok: 0, errors: 0, costUsd: 0, unknownCosts: 0 },
    );
    return {
      days: d,
      buckets: buckets.map((b) => ({ ...b, costUsd: round6(b.costUsd) })),
      totals: { ...totals, costUsd: round6(totals.costUsd) },
      byPlatform: [...byPlatform.entries()]
        .map(([platform, v]) => ({ platform, calls: v.calls, costUsd: round6(v.costUsd) }))
        .sort((a, b) => b.calls - a.calls),
    };
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function guessPlatformFromPath(path: string): string | null {
  const seg = path.split("/")[3]?.toLowerCase();
  if (!seg) return null;
  return PLATFORMS.some((p) => p.id === seg) ? seg : null;
}

function omitPrivateExamples(value: Record<string, unknown>): Record<string, unknown> {
  function clean(item: unknown, depth = 0): unknown {
    if (depth > 16) return null;
    if (Array.isArray(item)) return item.map((v) => clean(v, depth + 1));
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).filter(([k]) => !isPrivateField(k)).map(([k, v]) => [k, clean(v, depth + 1)]));
  }
  return clean(value) as Record<string, unknown>;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
