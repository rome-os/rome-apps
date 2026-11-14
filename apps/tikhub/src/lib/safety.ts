import { msg, render, type Lang, type MsgCode } from "./messages.js";

/** Public-data-only admission. Private credentials and state-changing operations
 * cannot be enabled with a caller-supplied confirmation. POST may be a read. */

export interface SafetyInput {
  path: string;
  summary?: string;
  operationId?: string;
  /** Parameter / body field names the operation declares as required. */
  requiredFields?: string[];
  /** Keys the caller actually supplied (query + body + path params). */
  suppliedKeys?: string[];
  method?: string;
  deprecated?: boolean;
  allowed?: boolean;
}

export interface SafetyVerdict {
  sensitive: boolean;
  /** Language-neutral reason codes; render with `safetyView()`. */
  codes: MsgCode[];
}

const MUTATION_PATTERNS: Array<[RegExp, MsgCode]> = [
  [/send_private_message/i, "reason.private_message"],
  [/increase_[a-z_]*(view|play|like|count)/i, "reason.inflate"],
  [/register_device/i, "reason.register_device"],
  [/(^|[/_])(login|logout|sso|authenticate)([/_]|$)/i, "reason.login"],
  [/encrypt_decrypt_login/i, "reason.login_crypto"],
  [/(^|\/)(post|publish|delete|follow|unfollow|digg|collect)_(video|comment|note|user|item)(\/|$)/i, "reason.account_write"],
];

const COOKIE_RE = /cookie/i;

export function assessSafety(input: SafetyInput): SafetyVerdict {
  const codes: MsgCode[] = [];
  const target = `${input.path} ${input.operationId ?? ""}`;
  for (const [re, code] of MUTATION_PATTERNS) {
    if (re.test(target) && !codes.includes(code)) codes.push(code);
  }
  const leaf = input.path.split("/").at(-1) ?? "";
  if ((!/^(fetch_|get_|search_|list_|parse_|extract_|convert_|translate_|batch_get_)/i.test(leaf) && input.path !== "/api/v1/hybrid/video_data") ||
      (input.method !== undefined && !["GET", "POST"].includes(input.method.toUpperCase()))) codes.push("reason.unsupported_operation");
  if (/(^|[/_])(cookie|session|password|authorization)([/_]|$)/i.test(input.path)) codes.push("reason.private_input");
  if (input.path.startsWith("/api/v1/tiktok/creator/")) codes.push("reason.private_input");
  if (input.deprecated) codes.push("reason.deprecated");
  if ((input.requiredFields ?? []).some((f) => COOKIE_RE.test(f))) codes.push("reason.cookie_required");
  else if ((input.suppliedKeys ?? []).some((k) => COOKIE_RE.test(k))) codes.push("reason.cookie_supplied");
  else if ([...(input.requiredFields ?? []), ...(input.suppliedKeys ?? [])].some(isPrivateField)) codes.push("reason.private_input");
  if (input.allowed === false && codes.length === 0) codes.push("reason.unsupported_operation");
  return { sensitive: codes.length > 0, codes };
}

/** Public shape: reasons rendered in exactly one language. */
export function safetyView(v: SafetyVerdict, lang: Lang): { sensitive: boolean; reasons: string[] } {
  return { sensitive: v.sensitive, reasons: v.codes.map((c) => render(msg(c), lang)) };
}

const PUBLIC_TOKEN_FIELDS = new Set(["page_token", "next_page_token", "continuation_token", "pagination_token", "rank_token", "xsec_token", "user_url_token", "search_session_id", "api_key_data", "api_key_name", "api_key_scopes", "api_key_status"]);
const SECRET_KEY_RE = /(cookie|token|authorization|password|secret|session|api.?key|credential)/i;

export function isPrivateField(key: string): boolean {
  return !PUBLIC_TOKEN_FIELDS.has(key.toLowerCase()) && (SECRET_KEY_RE.test(key) || /^proxy$/i.test(key));
}

export function suppliedFieldNames(value: unknown, depth = 0): string[] {
  if (typeof value === "string" && /https?:\/\/[^\s/"<>]+@|[?&](cookie|authorization|password|api_key|access_token|session_token)=/i.test(value)) return ["credential"];
  if (depth > 20 || !value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => [key, ...suppliedFieldNames(v, depth + 1)]);
}

export function scrubText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const decoded = out.replace(/\\u([a-f0-9]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (decoded.includes(secret)) out = decoded;
    for (const variant of new Set([secret, encodeURIComponent(secret)])) out = out.split(variant).join("[redacted]");
  }
  return out.replace(/(https?:\/\/)[^\s/"<>]+@/gi, "$1[redacted]@");
}

/** Deep-copy a request payload with secret-looking values replaced. Used for logs. */
export function redactSecrets(value: unknown, depth = 0, secrets: readonly string[] = []): unknown {
  if (depth > 20) return "[…]";
  if (typeof value === "string") return scrubText(value, secrets).replace(/\b(cookie|authorization|sessionid|password)\s*[:=]\s*[^\r\n"<>]+/gi, "$1=[redacted]");
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      scrubText(k, secrets), isPrivateField(k) && v != null && v !== "" ? "[redacted]" : redactSecrets(v, depth + 1, secrets),
    ]));
  }
  return value;
}

export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const tail = key.slice(-4);
  return `••••••••${tail}`;
}
