import { fetchAppApi } from "@rome-os/app-web-sdk";

export interface PublicSettings {
  configured: boolean;
  apiKeyMasked: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  qps: number;
  baseUrlOptions: Array<{ value: string; label: string }>;
}

export interface AccountInfo {
  configured: boolean;
  ok?: boolean;
  error?: string | null;
  user?: {
    email: unknown;
    balance: unknown;
    freeCredit: unknown;
    emailVerified: unknown;
    accountDisabled: unknown;
    isActive: unknown;
  } | null;
  apiKey?: { name: unknown; status: unknown; scopes: unknown; createdAt: unknown; expiresAt: unknown } | null;
  dailyUsage?: unknown;
  dailyUsageError?: string | null;
}

export interface Health {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  baseUrl: string;
  error: string | null;
}

export interface Stats {
  days: number;
  buckets: Array<{ date: string; calls: number; ok: number; errors: number; blocked: number; costUsd: number }>;
  totals: { calls: number; ok: number; errors: number; costUsd: number; unknownCosts: number };
  byPlatform: Array<{ platform: string; calls: number; costUsd: number }>;
}

export interface CatalogInfo {
  version: string | null;
  fetchedAt: string;
  operations: number;
  pricesFetchedAt: string | null;
  platforms: Array<{ id: string; label: string; note: string | null; operations: number; tags: Array<{ tag: string; operations: number }> }>;
}

export interface EndpointSummary {
  method: string;
  path: string;
  tag: string | null;
  tags: string[];
  platform: string | null;
  summary: string;
  operationId: string;
  brief: string;
  score: number;
  costUsd: number | null;
  guarded: boolean;
}

export interface SearchResponse {
  total: number;
  items: EndpointSummary[];
  platform: string | null;
  schemaVersion: string | null;
  unknownPlatform?: string;
}

export interface FieldInfo {
  name: string;
  in?: string;
  required: boolean;
  type: string | null;
  description: string;
  default?: unknown;
  enum?: unknown[];
  example?: unknown;
}

export interface EndpointDetail {
  method: string;
  path: string;
  tag: string | null;
  tags: string[];
  platform: string | null;
  summary: string;
  brief: string;
  description: string;
  parameters: FieldInfo[];
  body: null | { required: boolean; contentType: string; fields: FieldInfo[]; example?: unknown };
  requiredFields: string[];
  docsUrl: string;
  price: { costUsd: number | null; allowFreeCredit: boolean | null; allowDiscount: boolean | null; rateLimit: string | null } | null;
  safety: { sensitive: boolean; reasons: string[] };
  example: { query?: Record<string, unknown>; body?: Record<string, unknown> };
}

export interface CallOutcome {
  callId: string;
  status: "ok" | "error" | "blocked" | "dry_run";
  method: string;
  path: string;
  platform: string | null;
  httpStatus?: number;
  durationMs?: number;
  attempts?: number;
  requestId?: string | null;
  costUsd?: number | null;
  outcomeUnknown?: boolean;
  costBasis?: "base_estimate" | "not_billed" | "unknown";
  error?: string;
  warnings: string[];
  pagination?: Record<string, unknown> | null;
  paginationOmitted?: boolean;
  data?: unknown;
  truncated?: boolean;
  request?: { url: string; body?: unknown };
}

export interface CallRow {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  source: string;
  method: string;
  path: string;
  tag: string | null;
  platform: string | null;
  status: string;
  httpStatus: number | null;
  durationMs: number | null;
  attempts: number | null;
  requestJson: string | null;
  requestId: string | null;
  costUsd: number | null;
  errorMessage: string | null;
  responsePreview?: string | null;
  responseBytes: number | null;
}

/** Language the page is showing; sent so the backend renders messages in the same (single) language. */
let currentLang = "en";
export function setApiLang(lang: string): void {
  currentLang = lang;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-tikhub-lang", currentLang);
  const res = await fetchAppApi(path, { ...init, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new Error(b?.message ?? b?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export function postJson<T>(path: string, data: unknown, method = "POST"): Promise<T> {
  return api<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}

export function formatUsd(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "$0";
  return `$${v < 0.01 ? v.toFixed(Math.max(digits, 4)).replace(/0+$/, "") : v.toFixed(digits).replace(/\.?0+$/, "")}`;
}

export function formatScalar(v: unknown, yesNo: [string, string] = ["Yes", "No"]): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1e4) / 1e4);
  if (typeof v === "boolean") return v ? yesNo[0] : yesNo[1];
  return String(v);
}

export function endpointRoute(method: string, path: string): string {
  return `endpoint/${method.toLowerCase()}${path}`;
}
