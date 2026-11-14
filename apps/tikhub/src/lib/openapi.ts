/**
 * Pure helpers over the TikHub OpenAPI document: operation index, keyword
 * search (ported from tikhub_cli.py's scorer), and endpoint inspection.
 */
import { PREFERRED_TAGS, platformForTag, resolvePlatform } from "./platforms.js";

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

type Json = Record<string, unknown>;

export interface OpenApiDoc {
  info?: { version?: string; title?: string };
  paths: Record<string, Record<string, Json>>;
  components?: { schemas?: Record<string, Json> };
  tags?: Array<{ name: string; description?: string }>;
}

export interface OperationSummary {
  method: HttpMethod;
  path: string;
  tag: string | null;
  tags: string[];
  platform: string | null;
  summary: string;
  operationId: string;
  /** First ~240 chars of the English half of the description. */
  brief: string;
  /** Same, from the Chinese half. */
  briefZh: string;
}

export interface EndpointPrice {
  costUsd: number | null;
  allowFreeCredit: boolean | null;
  allowDiscount: boolean | null;
  rateLimit: string | null;
}

export interface ParamSummary {
  name: string;
  in: string;
  required: boolean;
  type: string | null;
  description: string;
  default?: unknown;
  enum?: unknown[];
  example?: unknown;
}

export interface BodyFieldSummary {
  name: string;
  required: boolean;
  type: string | null;
  description: string;
  default?: unknown;
  enum?: unknown[];
  example?: unknown;
}

export interface OperationDetail extends OperationSummary {
  description: string;
  parameters: ParamSummary[];
  body: null | {
    required: boolean;
    contentType: string;
    fields: BodyFieldSummary[];
    example?: unknown;
  };
  requiredFields: string[];
  docsUrl: string;
}

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value.toLowerCase());
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * TikHub descriptions are "# [中文] … # [English] … # [示例/Example] …".
 * Returns a short plain-text brief for one language (falls back to the whole text).
 */
export function briefDescription(description: string, max = 240, lang: "en" | "zh" = "en"): string {
  const [zhPart, enPart] = splitDescription(description);
  const picked = (lang === "zh" ? zhPart : enPart) || enPart || zhPart || description;
  const cleaned = picked
    .replace(/[#*`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function splitDescription(description: string): [string, string] {
  const noExample = description.split(/#\s*\[(示例|Example|示例\/Example|Price|价格)/i)[0] ?? description;
  const parts = noExample.split(/#\s*\[English\]/i);
  const zh = (parts[0] ?? "").replace(/#\s*\[中文\]/, "");
  const en = parts[1] ?? "";
  return [zh.trim(), en.trim()];
}

export function buildOperationIndex(doc: OpenApiDoc): OperationSummary[] {
  const out: OperationSummary[] = [];
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!isHttpMethod(method)) continue;
      const tags = Array.isArray(op.tags) ? [...new Set(op.tags as string[])] : [];
      out.push({
        method: method.toLowerCase() as HttpMethod,
        path,
        tag: tags[0] ?? null,
        tags,
        platform: platformForTag(tags[0]),
        summary: str(op.summary),
        operationId: str(op.operationId),
        brief: briefDescription(str(op.description)),
        briefZh: briefDescription(str(op.description), 240, "zh"),
      });
    }
  }
  return out;
}

const HAS_READ_VERB = /\b(fetch|get|search|list|detail|info|profile)\b|(^|[/_])(fetch|get|search)_/;
const DISCOURAGED = /(open_.*app|send_private|increase|authenticate|sso|login|register_device|encrypt|decrypt|generate_)/;

export function scoreOperation(op: OperationSummary, terms: string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [op.path, op.summary, op.operationId, op.brief, op.tags.join(" ")].join(" ").toLowerCase();
  const compactTarget = `${op.path} ${op.operationId}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const compact = term.replace(/[\s.-]+/g, "_");
    if (compact && compactTarget.includes(compact)) score += 20;
    if (haystack.includes(term)) score += 10;
    for (const word of term.split(/[\s_/.-]+/)) {
      if (word && haystack.includes(word)) score += 2;
    }
  }
  if (score === 0) return 0;
  if (HAS_READ_VERB.test(haystack)) score += 5;
  if (DISCOURAGED.test(compactTarget)) score -= 30;
  return score;
}

export function preferredRank(op: OperationSummary): number {
  const idx = PREFERRED_TAGS.findIndex((t) => op.tags.includes(t));
  return idx === -1 ? PREFERRED_TAGS.length : idx;
}

export function tokenize(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const parts = q.split(/\s+/).filter(Boolean);
  // Keep the whole phrase too, so "user profile" also matches "fetch_user_profile".
  return parts.length > 1 ? [q, ...parts] : parts;
}

export interface SearchOptions {
  query?: string;
  platform?: string | null;
  tag?: string | null;
  method?: string | null;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  items: Array<OperationSummary & { score: number }>;
  platform: string | null;
  unknownPlatform?: string;
}

export function searchOperations(index: OperationSummary[], opts: SearchOptions): SearchResult {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  let pool = index;
  let platformId: string | null = null;
  let unknownPlatform: string | undefined;
  if (opts.platform) {
    const p = resolvePlatform(opts.platform);
    if (p) {
      platformId = p.id;
      pool = pool.filter((op) => op.tags.some((t) => p.tags.includes(t)) || op.platform === p.id);
    } else {
      unknownPlatform = opts.platform;
      pool = [];
    }
  }
  if (opts.tag) pool = pool.filter((op) => op.tags.includes(opts.tag!));
  if (opts.method) pool = pool.filter((op) => op.method === opts.method!.toLowerCase());

  const terms = tokenize(opts.query ?? "");
  const scored = pool
    .map((op) => ({ ...op, score: scoreOperation(op, terms) }))
    .filter((op) => op.score > 0);

  const tagOrder = (op: OperationSummary): number => {
    if (!platformId) return 0;
    const p = resolvePlatform(platformId)!;
    const i = p.tags.indexOf(op.tag ?? "");
    return i === -1 ? p.tags.length : i;
  };

  scored.sort((a, b) => {
    if (terms.length > 0 && b.score !== a.score) return b.score - a.score;
    const pr = preferredRank(a) - preferredRank(b);
    if (pr !== 0) return pr;
    const to = tagOrder(a) - tagOrder(b);
    if (to !== 0) return to;
    return a.path.localeCompare(b.path);
  });

  return {
    total: scored.length,
    items: scored.slice(offset, offset + limit),
    platform: platformId,
    ...(unknownPlatform ? { unknownPlatform } : {}),
  };
}

/** Resolve local `#/…` refs recursively (cycle-safe). */
export function resolveRef(doc: OpenApiDoc, value: unknown, seen: Set<string> = new Set()): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRef(doc, v, seen));
  if (value && typeof value === "object") {
    const obj = value as Json;
    const ref = obj.$ref;
    if (typeof ref === "string" && ref.startsWith("#/")) {
      if (seen.has(ref)) return { type: "object", description: `(recursive ${ref})` };
      let node: unknown = doc;
      for (const part of ref.slice(2).split("/")) node = (node as Json | undefined)?.[part];
      const next = new Set(seen);
      next.add(ref);
      return resolveRef(doc, node, next);
    }
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveRef(doc, v, seen);
    return out;
  }
  return value;
}

function schemaType(schema: Json | undefined): string | null {
  if (!schema) return null;
  if (typeof schema.type === "string") {
    if (schema.type === "array") {
      const items = schema.items as Json | undefined;
      return `array<${schemaType(items) ?? "any"}>`;
    }
    return schema.type;
  }
  const variants = (schema.anyOf ?? schema.oneOf) as Json[] | undefined;
  if (Array.isArray(variants)) {
    const types = variants.map((v) => schemaType(v)).filter((t): t is string => !!t && t !== "null");
    return types.length ? [...new Set(types)].join(" | ") : null;
  }
  return null;
}

function cleanDesc(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function findOperation(doc: OpenApiDoc, method: string, path: string): Json | null {
  const methods = doc.paths?.[path];
  if (!methods) return null;
  return (methods[method.toLowerCase()] as Json | undefined) ?? null;
}

/** Methods available for a path (used to default the method when the caller omits it). */
export function methodsForPath(doc: OpenApiDoc, path: string): HttpMethod[] {
  const methods = doc.paths?.[path];
  if (!methods) return [];
  return Object.keys(methods).filter(isHttpMethod).map((m) => m.toLowerCase() as HttpMethod);
}

export function inspectOperation(doc: OpenApiDoc, method: string, path: string): OperationDetail | null {
  const raw = findOperation(doc, method, path);
  if (!raw) return null;
  const op = resolveRef(doc, raw) as Json;
  const tags = Array.isArray(op.tags) ? [...new Set(op.tags as string[])] : [];
  const parameters: ParamSummary[] = (Array.isArray(op.parameters) ? (op.parameters as Json[]) : []).map((p) => {
    const schema = (p.schema ?? {}) as Json;
    return {
      name: str(p.name),
      in: str(p.in),
      required: p.required === true,
      type: schemaType(schema),
      description: cleanDesc(str(p.description) || str(schema.description)),
      ...(schema.default !== undefined ? { default: schema.default } : {}),
      ...(Array.isArray(schema.enum) ? { enum: schema.enum as unknown[] } : {}),
      ...(p.example !== undefined ? { example: p.example } : schema.example !== undefined ? { example: schema.example } : {}),
    };
  });

  let body: OperationDetail["body"] = null;
  const rb = op.requestBody as Json | undefined;
  if (rb && typeof rb === "object") {
    const content = (rb.content ?? {}) as Record<string, Json>;
    const [contentType, media] = Object.entries(content)[0] ?? ["application/json", {}];
    const schema = ((media as Json).schema ?? {}) as Json;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const props = (schema.properties ?? {}) as Record<string, Json>;
    body = {
      required: rb.required === true,
      contentType,
      fields: Object.entries(props).map(([name, prop]) => ({
        name,
        required: required.has(name),
        type: schemaType(prop),
        description: cleanDesc(str(prop.description) || str(prop.title)),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(Array.isArray(prop.enum) ? { enum: prop.enum as unknown[] } : {}),
        ...(prop.example !== undefined ? { example: prop.example } : {}),
      })),
      ...(schema.example !== undefined
        ? { example: schema.example }
        : (media as Json).example !== undefined
          ? { example: (media as Json).example }
          : {}),
    };
  }

  const requiredFields = [
    ...parameters.filter((p) => p.required).map((p) => p.name),
    ...(body?.fields.filter((f) => f.required).map((f) => f.name) ?? []),
  ];
  const operationId = str(op.operationId);
  const tag = tags[0] ?? null;
  const description = str(op.description);

  return {
    method: method.toLowerCase() as HttpMethod,
    path,
    tag,
    tags,
    platform: platformForTag(tag),
    summary: str(op.summary),
    operationId,
    brief: briefDescription(description),
    briefZh: briefDescription(description, 240, "zh"),
    description: description.length > 4000 ? `${description.slice(0, 4000)}…` : description,
    parameters,
    body,
    requiredFields,
    docsUrl: tag && operationId ? `https://api.tikhub.io/#/${tag}/${operationId}` : "https://docs.tikhub.io/",
  };
}

/** Parse `get_all_endpoints_info` rows into a path → price map. */
export function parsePriceList(data: unknown): Record<string, EndpointPrice> {
  const out: Record<string, EndpointPrice> = {};
  if (!Array.isArray(data)) return out;
  for (const row of data as Json[]) {
    const uri = str(row.endpoint_uri);
    if (!uri) continue;
    out[uri] = parsePriceRow(row);
  }
  return out;
}

export function parsePriceRow(row: Json): EndpointPrice {
  const rawCost = row.endpoint_cost;
  const cost = typeof rawCost === "number" || (typeof rawCost === "string" && rawCost.trim() !== "") ? Number(rawCost) : NaN;
  const bool = (v: unknown): boolean | null => (v === true || v === 1 || v === "1" || v === "true") ? true : (v === false || v === 0 || v === "0" || v === "false") ? false : null;
  return {
    costUsd: Number.isFinite(cost) && cost >= 0 ? cost : null,
    allowFreeCredit: bool(row.allow_free_credit),
    allowDiscount: bool(row.allow_discount),
    rateLimit: typeof row.rate_limit === "string" ? row.rate_limit : null,
  };
}
