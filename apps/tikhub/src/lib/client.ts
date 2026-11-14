/**
 * Minimal TikHub HTTP client: Bearer auth, timeout, bounded retries on
 * anonymous metadata GET failures only; sent data requests are never replayed.
 */

import { AppError, msg, render, type Msg } from "./messages.js";
import { redactSecrets, scrubText } from "./safety.js";

export const DEFAULT_BASE_URL = "https://api.tikhub.io";
export const CHINA_BASE_URL = "https://api.tikhub.dev";
export const USER_AGENT = "rome-tikhub-app/0.1";

export interface ClientOptions {
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxRetries: number;
  qps: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  acquireSlot?: () => Promise<void>;
  beginRequest?: () => () => void;
}

export interface RequestSpec {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Skip the Authorization header (public endpoints like health/pricing). */
  anonymous?: boolean;
}

export interface TikHubResponse {
  ok: boolean;
  httpStatus: number;
  attempts: number;
  durationMs: number;
  url: string;
  /** Parsed JSON if possible, otherwise the raw text. */
  payload: unknown;
  bytes: number;
  /** Structured error, rendered per language at the edge. */
  error: Msg | null;
  /** English rendering of `error`, for logs. */
  errorMessage: string | null;
  requestId: string | null;
  outcomeUnknown: boolean;
}

/** Caller-fixable configuration / input problem. */
export class TikHubConfigError extends AppError {}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Process-local fallback for metadata/tests; data calls inject a DB-backed gate. */
const limiterState = { nextSlot: 0 };

async function acquireSlot(qps: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const interval = 1000 / Math.max(1, Math.min(qps, 50));
  const now = Date.now();
  const slot = Math.max(now, limiterState.nextSlot);
  limiterState.nextSlot = slot + interval;
  if (slot > now) await sleep(slot - now);
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return url.toString();
}

export function substitutePathParams(path: string, params?: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const v = params?.[name];
    if (v === undefined || v === null || v === "") throw new TikHubConfigError(msg("config.missingPathParam", { name }));
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(v))) throw new TikHubConfigError(msg("config.badPath"));
    return encodeURIComponent(String(v));
  });
}

/** Pull a human message out of TikHub's success/error envelopes. */
export function extractMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return typeof payload === "string" ? payload.slice(0, 500) : null;
  const obj = payload as Record<string, unknown>;
  const detail = obj.detail;
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const msg = [d.message_zh, d.message].filter((m) => typeof m === "string" && m).map((m) => String(m).slice(0, 500)).join(" / ");
    if (msg) return msg;
  }
  if (typeof detail === "string") return detail.slice(0, 500);
  if (Array.isArray(detail)) {
    return detail
      .slice(0, 20)
      .map((d) => {
        const e = d as Record<string, unknown>;
        const loc = Array.isArray(e.loc) ? e.loc.slice(0, 6).map((v) => String(v).slice(0, 80)).join(".") : "";
        return `${loc}: ${String(e.msg ?? "").slice(0, 500)}`.trim();
      })
      .join("; ").slice(0, 500);
  }
  const msg = [obj.message_zh, obj.message].filter((m) => typeof m === "string" && m).map((m) => String(m).slice(0, 500)).join(" / ");
  return msg || null;
}

export function extractRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.request_id === "string") return obj.request_id.slice(0, 200);
  const d = obj.detail as Record<string, unknown> | undefined;
  return d && typeof d.request_id === "string" ? d.request_id.slice(0, 200) : null;
}

/** Our explanation of an HTTP failure, with TikHub's own message attached as `upstream`. */
export function httpErrorMsg(status: number, payload: unknown): Msg {
  const upstream = extractUpstream(payload) ?? undefined;
  const known = [400, 401, 402, 403, 404, 422, 429];
  if (known.includes(status)) return msg(`http.${status}` as "http.400", undefined, upstream);
  if (status >= 500) return msg("http.5xx", { status }, upstream);
  return msg("http.other", { status }, upstream);
}

/** TikHub's own message in both languages (message_zh / message, or FastAPI `detail`). */
export function extractUpstream(payload: unknown): { zh: string; en: string } | null {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" && payload ? { zh: payload.slice(0, 500), en: payload.slice(0, 500) } : null;
  }
  const obj = payload as Record<string, unknown>;
  const src = obj.detail && typeof obj.detail === "object" && !Array.isArray(obj.detail) ? (obj.detail as Record<string, unknown>) : obj;
  const zh = typeof src.message_zh === "string" ? src.message_zh.slice(0, 500) : "";
  const en = typeof src.message === "string" ? src.message.slice(0, 500) : "";
  if (zh || en) return { zh: zh || en, en: en || zh };
  const flat = extractMessage(payload);
  return flat ? { zh: flat, en: flat } : null;
}

export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 64 * 1024;
const PUBLIC_METADATA = new Set(["/openapi.json", "/api/v1/tikhub/user/get_all_endpoints_info", "/api/v1/health/check"]);

class ResponseLimitError extends Error {}

async function readBounded(res: Response): Promise<{ text: string; bytes: number }> {
  if (Number(res.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    throw new ResponseLimitError();
  }
  if (!res.body) return { text: "", bytes: 0 };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ResponseLimitError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return { text: text + decoder.decode(), bytes };
  } finally { reader.releaseLock(); }
}

export async function tikhubRequest(opts: ClientOptions, spec: RequestSpec): Promise<TikHubResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? sleepDefault;
  if (!spec.anonymous && !opts.apiKey) throw new TikHubConfigError(msg("config.noKey"));
  const method = spec.method.toUpperCase();
  const url = buildUrl(opts.baseUrl, spec.path, spec.query);
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (!spec.anonymous && opts.apiKey) headers.Authorization = "Bearer " + opts.apiKey;
  let bodyText: string | undefined;
  if (spec.body !== undefined && method !== "GET") {
    headers["Content-Type"] = "application/json";
    bodyText = JSON.stringify(spec.body);
  }
  if (new TextEncoder().encode((bodyText ?? "") + url).byteLength > MAX_REQUEST_BYTES) throw new TikHubConfigError(msg("config.requestTooLarge"));
  const retrySafe = spec.anonymous === true && method === "GET" && PUBLIC_METADATA.has(spec.path);
  const maxAttempts = retrySafe ? 1 + Math.max(0, Math.min(opts.maxRetries, 5)) : 1;
  const started = Date.now();
  const secrets = opts.apiKey ? [opts.apiKey] : [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.acquireSlot) await opts.acquireSlot();
    else await acquireSlot(opts.qps, sleep);
    const release = opts.beginRequest?.();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let waitMs: number | null = null;
    let response: TikHubResponse;
    try {
      const res = await fetchImpl(url, { method, headers, body: bodyText, signal: controller.signal, redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const error = msg("net.redirect");
        return { ok: false, httpStatus: res.status, attempts: attempt, durationMs: Date.now() - started, url: scrubText(url, secrets), payload: null, bytes: 0, error, errorMessage: render(error, "en"), requestId: null, outcomeUnknown: !retrySafe };
      }
      const raw = await readBounded(res);
      let payload: unknown;
      let validJson = true;
      try { payload = raw.text ? JSON.parse(raw.text) : null; }
      catch { payload = null; validJson = false; }
      // Parse before scrubbing, so JSON escapes cannot restore a key afterwards.
      // Public schemas must retain credential field definitions, not user data.
      payload = retrySafe ? scrubMetadata(payload, secrets) : redactSecrets(payload, 0, secrets);
      const businessCode = payload && typeof payload === "object" ? (payload as Record<string, unknown>).code : undefined;
      const businessOk = businessCode === undefined || businessCode === 200 || businessCode === "200";
      const ok = res.ok && businessOk && validJson;
      // Error bodies are not a diagnostic channel: even an obfuscated credential
      // echo must not reach an agent, HTTP response or persisted preview.
      const error = ok ? null : res.ok && !validJson ? msg("net.invalidJson") : res.ok ? msg("http.business", { code: typeof businessCode === "number" ? businessCode : "invalid" }) : httpErrorMsg(res.status, null);
      response = { ok, httpStatus: res.status, attempts: attempt, durationMs: Date.now() - started, url: scrubText(url, secrets), payload: ok ? payload : null, bytes: raw.bytes, error, errorMessage: error ? render(error, "en") : null, requestId: ok ? extractRequestId(payload) : null, outcomeUnknown: false };
      if (!retrySafe || ok || attempt >= maxAttempts || (res.status !== 429 && res.status < 500)) return response;
      const retryAfter = res.headers.get("retry-after");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const requestedWait = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      // A long wait ends this chain; never retry earlier than requested.
      if (Number.isFinite(requestedWait) && requestedWait > 30_000) return response;
      waitMs = Number.isFinite(requestedWait) && requestedWait > 0 ? requestedWait : 1000 * 2 ** (attempt - 1);
    } catch (err) {
      const error = err instanceof ResponseLimitError ? msg("net.tooLarge") : msg("net.unknown");
      response = { ok: false, httpStatus: 0, attempts: attempt, durationMs: Date.now() - started, url: scrubText(url, secrets), payload: null, bytes: 0, error, errorMessage: render(error, "en"), requestId: null, outcomeUnknown: !retrySafe };
      if (!retrySafe || err instanceof ResponseLimitError || attempt >= maxAttempts) return response;
      waitMs = 1000 * 2 ** (attempt - 1);
    } finally {
      clearTimeout(timer);
      try { release?.(); } catch { /* A failed release expires conservatively; never replay a sent request. */ }
    }
    if (waitMs !== null) await sleep(waitMs);
  }
  throw new Error("Unreachable request state");
}

function scrubMetadata(value: unknown, secrets: readonly string[]): unknown {
  return JSON.parse(scrubText(JSON.stringify(value), secrets));
}

/** Compatibility helper: parsed data and exception boundaries also need care. */
export function scrubSecret(text: string, secret: string | null | undefined): string {
  return scrubText(text, secret ? [secret] : []);
}

/** Test hook: reset the process-local fallback limiter between unit tests. */
export function __resetLimiter(): void { limiterState.nextSlot = 0; }
