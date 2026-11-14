/**
 * Shape TikHub responses for agents and logs: strip envelope boilerplate,
 * surface pagination hints, and truncate oversized payloads predictably.
 */

type Json = Record<string, unknown>;

const ENVELOPE_NOISE = new Set([
  "support",
  "docs",
  "cache_message",
  "cache_message_zh",
  "cache_url",
  "time",
  "time_stamp",
  "time_zone",
  "message",
  "message_zh",
  "code",
  "request_id",
  "router",
  "params",
]);

/** Returns the useful part of a TikHub envelope ({code, message, data, …} → data). */
export function unwrapEnvelope(payload: unknown): { data: unknown; meta: Json } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { data: payload, meta: {} };
  const obj = payload as Json;
  if (!("data" in obj) && !("code" in obj)) return { data: payload, meta: {} };
  const meta: Json = {};
  for (const k of ["code", "message", "request_id", "cache_url"]) if (obj[k] !== undefined) meta[k] = obj[k];
  const extras: Json = {};
  for (const [k, v] of Object.entries(obj)) if (k !== "data" && !ENVELOPE_NOISE.has(k)) extras[k] = v;
  return { data: Object.keys(extras).length ? { ...extras, data: obj.data } : obj.data, meta };
}

const PAGINATION_KEYS = [
  "cursor",
  "max_cursor",
  "min_cursor",
  "next_cursor",
  "has_more",
  "hasMore",
  "has_next",
  "offset",
  "next_offset",
  "search_id",
  "searchId",
  "backtrace",
  "page_token",
  "next_page_token",
  "continuation_token",
  "continuation",
  "pagination_token",
  "end_cursor",
  "page",
  "total",
  "log_pb",
];

export interface PaginationResult {
  value: Json | null;
  omitted: boolean;
}

/** Bounded scan. Never shorten a cursor into a different, apparently valid token. */
export function boundedPagination(data: unknown, maxChars = 4096): PaginationResult {
  const found: Json = {};
  const queue: Array<{ node: unknown; depth: number; prefix: string }> = [{ node: data, depth: 0, prefix: "" }];
  let omitted = false;
  let visitedFields = 0;
  let accepted = 0;
  for (let i = 0; i < queue.length; i++) {
    const { node, depth, prefix } = queue[i]!;
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    for (const [k, v] of Object.entries(node as Json)) {
      if (++visitedFields > 2048) return { value: accepted ? found : null, omitted: true };
      if (PAGINATION_KEYS.includes(k)) {
        const key = prefix ? `${prefix}.${k}` : k;
        const scalar = k === "log_pb" && v && typeof v === "object" ? (v as Json).impr_id : v;
        if (scalar !== null && !["string", "number", "boolean"].includes(typeof scalar)) { omitted = true; continue; }
        if (accepted >= 32 || key.length > 200 || (typeof scalar === "string" && scalar.length > 1024)) { omitted = true; continue; }
        const next = { ...found, [key]: scalar };
        if (safeLength(next) > maxChars) { omitted = true; continue; }
        found[key] = scalar;
        accepted++;
      } else if (depth < 4 && v && typeof v === "object" && !Array.isArray(v)) {
        if (queue.length >= 128 || k.length > 200) omitted = true;
        else queue.push({ node: v, depth: depth + 1, prefix: prefix ? `${prefix}.${k}` : k });
      }
    }
  }
  return { value: accepted ? found : null, omitted };
}

export function extractPagination(data: unknown): Json | null {
  return boundedPagination(data).value;
}

/** maxChars covers the serialized {data,pagination} pair, not fixed audit metadata. */
export function shapeCallPayload(data: unknown, maxChars: number) {
  const pagination = boundedPagination(data, Math.min(4096, Math.floor(maxChars / 4)));
  const overhead = safeLength({ data: null, pagination: pagination.value }) - 4;
  const shaped = truncateForAgent(data, maxChars - overhead);
  return { ...shaped, pagination: pagination.value, paginationOmitted: pagination.omitted };
}

export interface TruncateResult {
  value: unknown;
  truncated: boolean;
  originalChars: number;
}

/**
 * Keep the payload under `maxChars` of JSON. Progressively shortens long
 * strings and arrays, and records what was cut with `…(N more)` markers.
 */
export function truncateForAgent(value: unknown, maxChars: number): TruncateResult {
  const originalChars = safeLength(value);
  if (originalChars <= maxChars) return { value, truncated: false, originalChars };
  const plans: Array<[number, number]> = [
    [20, 2000],
    [10, 800],
    [5, 400],
    [3, 200],
    [2, 120],
    [1, 80],
  ];
  let best: unknown = value;
  for (const [arr, strMax] of plans) {
    best = prune(value, arr, strMax, 0);
    if (safeLength(best) <= maxChars) return { value: best, truncated: true, originalChars };
  }
  const text = JSON.stringify(best) ?? "";
  const suffix = "…(truncated)";
  let low = 0;
  let high = Math.min(text.length, maxChars);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (JSON.stringify(text.slice(0, mid) + suffix).length <= maxChars) low = mid;
    else high = mid - 1;
  }
  return { value: text.slice(0, low) + suffix, truncated: true, originalChars };
}

function prune(value: unknown, maxArr: number, maxStr: number, depth: number): unknown {
  if (typeof value === "string") return value.length > maxStr ? `${value.slice(0, maxStr)}…(+${value.length - maxStr} chars)` : value;
  if (Array.isArray(value)) {
    const head = value.slice(0, maxArr).map((v) => prune(v, maxArr, maxStr, depth + 1));
    if (value.length > maxArr) head.push(`…(${value.length - maxArr} more items)`);
    return head;
  }
  if (value && typeof value === "object") {
    if (depth > 12) return "{…}";
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) out[k] = prune(v, maxArr, maxStr, depth + 1);
    return out;
  }
  return value;
}

function safeLength(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? "").length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Persist valid, compact JSON within the DB read budget, including strings.
 * Never slice serialized JSON: old malformed rows remain withheld at read time. */
export function previewText(value: unknown, maxChars = 16_000): string {
  const budget = Number.isFinite(maxChars) ? Math.max(32, Math.min(16_000, Math.floor(maxChars))) : 16_000;
  return JSON.stringify(truncateForAgent(value ?? null, budget).value);
}
