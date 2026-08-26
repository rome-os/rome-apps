import { lookup } from "node:dns/promises";
import { extname } from "node:path";
import { isIP } from "node:net";
import { createAppLogger } from "@rome-os/app-runtime";

const log = createAppLogger("discord-digest_link_read");

export const DEFAULT_LINK_LINE_LIMIT = 80;
const MAX_LINK_LINE_LIMIT = 400;
const MAX_RETURN_CHARS = 16_000;
const METADATA_READ_BYTES = 192 * 1024;
const TEXT_READ_BYTES = 1024 * 1024;
const PDF_READ_BYTES = 8 * 1024 * 1024;
const LINK_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

export type LinkReadMode = "metadata" | "excerpt";

export interface LinkReadRequest {
  url: string;
  mode?: LinkReadMode;
  offset?: number;
  limit?: number;
}

export interface LinkReadResult {
  ok: boolean;
  reason?: string;
  url?: string;
  finalUrl?: string;
  contentType?: string;
  contentLength?: number;
  title?: string;
  description?: string;
  siteName?: string;
  text?: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  hasMore?: boolean;
  sourceTruncated?: boolean;
}

interface FetchedBytes {
  finalUrl: string;
  contentType?: string;
  contentLength?: number;
  buffer: Buffer;
  truncated: boolean;
}

interface ExtractedLinkDocument {
  url: string;
  finalUrl: string;
  contentType?: string;
  contentLength?: number;
  title?: string;
  description?: string;
  siteName?: string;
  text?: string;
  sourceTruncated: boolean;
  reason?: string;
}

interface CacheEntry {
  doc: ExtractedLinkDocument;
  hasText: boolean;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

function setCached(key: string, value: CacheEntry): void {
  cache.set(key, value);
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0];
  if (oldest) cache.delete(oldest);
}

function getCached(key: string, needText: boolean): ExtractedLinkDocument | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  if (needText && !hit.hasText) return null;
  return hit.doc;
}

function cleanInputUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inIpv4Cidr(address: string, base: string, bits: number): boolean {
  const addr = ipv4ToNumber(address);
  const baseNum = ipv4ToNumber(base);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) === (baseNum & mask);
}

function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, bits]) => inIpv4Cidr(address, String(base), Number(bits)));
  }

  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice("::ffff:".length);
      return isPrivateOrReservedIp(mapped);
    }
    return (
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("ff") ||
      lower.startsWith("2001:db8")
    );
  }

  return true;
}

async function validatePublicHttpUrl(value: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "unsupported_protocol" };
  if (url.username || url.password) return { ok: false, reason: "url_credentials_not_allowed" };

  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "private_or_local_host" };
  }

  if (isIP(host)) {
    if (isPrivateOrReservedIp(host)) return { ok: false, reason: "private_or_reserved_ip" };
    return { ok: true, url };
  }

  try {
    const records = await lookup(host, { all: true, verbatim: false });
    if (records.length === 0) return { ok: false, reason: "dns_lookup_failed" };
    if (records.some((record) => isPrivateOrReservedIp(record.address))) {
      return { ok: false, reason: "private_or_reserved_ip" };
    }
  } catch {
    return { ok: false, reason: "dns_lookup_failed" };
  }

  return { ok: true, url };
}

async function readResponseBody(response: Response, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const contentLengthHeader = response.headers.get("content-length");
  const declaredLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    // Still read only the leading window; callers decide whether a truncated
    // sample is usable for metadata/text. PDF extraction rejects truncation.
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer: buffer.subarray(0, maxBytes), truncated: buffer.byteLength > maxBytes };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value);
      if (total + chunk.byteLength > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return { buffer: Buffer.concat(chunks), truncated };
}

async function fetchLinkBytes(inputUrl: string, maxBytes: number): Promise<FetchedBytes | { error: string; finalUrl?: string }> {
  let current = inputUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const validation = await validatePublicHttpUrl(current);
    if (!validation.ok) return { error: validation.reason, finalUrl: current };

    const response = await fetch(validation.url.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(LINK_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml,application/pdf;q=0.9,*/*;q=0.2",
        "User-Agent": "Rome Discord Digest link inspector/1.0",
      },
    }).catch((err) => {
      log.warn("link fetch failed", { url: validation.url.hostname, error: err instanceof Error ? err.message : String(err) });
      return null;
    });

    if (!response) return { error: "fetch_failed", finalUrl: current };

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { error: "redirect_without_location", finalUrl: current };
      current = new URL(location, validation.url).href;
      continue;
    }

    if (!response.ok) return { error: `http_${response.status}`, finalUrl: current };

    const { buffer, truncated } = await readResponseBody(response, maxBytes);
    const contentLengthHeader = response.headers.get("content-length");
    const declaredLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
    return {
      finalUrl: response.url || current,
      contentType: response.headers.get("content-type") ?? undefined,
      contentLength: Number.isFinite(declaredLength) ? declaredLength : undefined,
      buffer,
      truncated,
    };
  }

  return { error: "too_many_redirects", finalUrl: current };
}

function fileExtensionFromUrl(value: string): string {
  try {
    return extname(new URL(value).pathname).toLowerCase();
  } catch {
    return "";
  }
}

function isHtml(contentType: string | undefined, url: string): boolean {
  const type = contentType?.toLowerCase() ?? "";
  const ext = fileExtensionFromUrl(url);
  return type.includes("text/html") || type.includes("application/xhtml+xml") || (!type && ["", ".html", ".htm"].includes(ext));
}

function isTextLike(contentType: string | undefined, url: string): boolean {
  const type = contentType?.toLowerCase() ?? "";
  if (type.startsWith("text/")) return true;
  if (["application/json", "application/ld+json", "application/xml", "application/rss+xml", "application/atom+xml"].some((t) => type.includes(t))) {
    return true;
  }
  return new Set([".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".log"]).has(fileExtensionFromUrl(url));
}

function isPdf(contentType: string | undefined, url: string): boolean {
  return (contentType?.toLowerCase().includes("application/pdf") ?? false) || fileExtensionFromUrl(url) === ".pdf";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&apos;/giu, "'");
}

function attrValue(tag: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}\\s*=\\s*(["'])(.*?)\\1`, "iu");
  const quoted = tag.match(re)?.[2];
  if (quoted) return decodeHtmlEntities(quoted.trim());
  const bare = tag.match(new RegExp(`${attr}\\s*=\\s*([^\\s>]+)`, "iu"))?.[1];
  return bare ? decodeHtmlEntities(bare.trim()) : undefined;
}

function metaContent(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\s+[^>]*>/giu) ?? [];
  const lowerKey = key.toLowerCase();
  for (const tag of tags) {
    const name = attrValue(tag, "name")?.toLowerCase();
    const property = attrValue(tag, "property")?.toLowerCase();
    if (name === lowerKey || property === lowerKey) return attrValue(tag, "content");
  }
  return undefined;
}

function normalizeTextLines(value: string): string {
  return value
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "\n")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, "\n")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, "\n")
    .replace(/<(?:p|div|section|article|header|footer|aside|main|br|li|ul|ol|h[1-6]|blockquote|pre|tr|table)\b[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  return normalizeTextLines(decodeHtmlEntities(stripped));
}

function extractHtmlDocument(html: string, fetched: FetchedBytes, includeText: boolean): ExtractedLinkDocument {
  const title = decodeHtmlEntities((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "").replace(/\s+/gu, " ").trim()) || undefined;
  const description = metaContent(html, "og:description") ?? metaContent(html, "description") ?? metaContent(html, "twitter:description");
  const siteName = metaContent(html, "og:site_name") ?? metaContent(html, "application-name");
  return {
    url: fetched.finalUrl,
    finalUrl: fetched.finalUrl,
    contentType: fetched.contentType,
    contentLength: fetched.contentLength,
    title,
    description,
    siteName,
    text: includeText ? htmlToText(html) : undefined,
    sourceTruncated: fetched.truncated,
  };
}

async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(proxy, { mergePages: true });
    const raw = Array.isArray(text) ? text.join("\n") : text;
    return normalizeTextLines(raw ?? "") || null;
  } catch (err) {
    log.warn("pdf link extraction failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function sliceLines(text: string, offset: number | undefined, limit: number | undefined): Pick<LinkReadResult, "text" | "startLine" | "endLine" | "totalLines" | "hasMore"> {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const start = Math.max(1, Math.floor(offset ?? 1) || 1);
  const count = Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_LINK_LINE_LIMIT) || DEFAULT_LINK_LINE_LIMIT, MAX_LINK_LINE_LIMIT));
  const startIdx = Math.min(start - 1, totalLines);
  const endIdx = Math.min(startIdx + count, totalLines);
  const selected = lines.slice(startIdx, endIdx);
  let selectedText = selected.join("\n");
  let charCapped = false;
  if (selectedText.length > MAX_RETURN_CHARS) {
    selectedText = `${selectedText.slice(0, MAX_RETURN_CHARS).trim()}\n...[truncated — request fewer lines or a later offset]`;
    charCapped = true;
  }
  return {
    text: selectedText,
    startLine: selected.length > 0 ? startIdx + 1 : 0,
    endLine: selected.length > 0 ? endIdx : 0,
    totalLines,
    hasMore: endIdx < totalLines || charCapped,
  };
}

async function extractLinkDocument(inputUrl: string, includeText: boolean): Promise<ExtractedLinkDocument> {
  const maxBytes = includeText ? PDF_READ_BYTES : METADATA_READ_BYTES;
  const fetched = await fetchLinkBytes(inputUrl, maxBytes);
  if ("error" in fetched) {
    return { url: inputUrl, finalUrl: fetched.finalUrl ?? inputUrl, sourceTruncated: false, reason: fetched.error };
  }

  const html = isHtml(fetched.contentType, fetched.finalUrl);
  const pdf = isPdf(fetched.contentType, fetched.finalUrl);
  const textLike = isTextLike(fetched.contentType, fetched.finalUrl);

  if (html) {
    const htmlText = fetched.buffer.toString("utf8");
    return extractHtmlDocument(htmlText, fetched, includeText);
  }

  if (textLike) {
    const text = includeText ? normalizeTextLines(fetched.buffer.toString("utf8")) : undefined;
    return {
      url: inputUrl,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      contentLength: fetched.contentLength,
      text,
      sourceTruncated: fetched.truncated,
    };
  }

  if (pdf) {
    if (!includeText) {
      return {
        url: inputUrl,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        contentLength: fetched.contentLength,
        sourceTruncated: fetched.truncated,
      };
    }
    if (fetched.truncated) {
      return {
        url: inputUrl,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        contentLength: fetched.contentLength,
        sourceTruncated: true,
        reason: "pdf_too_large",
      };
    }
    const text = await extractPdfText(fetched.buffer);
    return {
      url: inputUrl,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      contentLength: fetched.contentLength,
      text: text ?? undefined,
      sourceTruncated: false,
      reason: text ? undefined : "pdf_text_extraction_failed",
    };
  }

  return {
    url: inputUrl,
    finalUrl: fetched.finalUrl,
    contentType: fetched.contentType,
    contentLength: fetched.contentLength,
    sourceTruncated: fetched.truncated,
    reason: "unsupported_content_type",
  };
}

export async function readLink(request: LinkReadRequest): Promise<LinkReadResult> {
  const url = cleanInputUrl(request.url);
  if (!url) return { ok: false, reason: "invalid_url" };

  const mode = request.mode ?? "metadata";
  const includeText = mode === "excerpt";
  const cached = getCached(url, includeText);
  const doc = cached ?? (await extractLinkDocument(url, includeText));
  if (!cached) setCached(url, { doc, hasText: includeText && Boolean(doc.text), createdAt: Date.now() });

  const base: LinkReadResult = {
    ok: !doc.reason || Boolean(doc.title || doc.description || doc.text || doc.contentType),
    reason: doc.reason,
    url,
    finalUrl: doc.finalUrl,
    contentType: doc.contentType,
    contentLength: doc.contentLength,
    title: doc.title,
    description: doc.description,
    siteName: doc.siteName,
    sourceTruncated: doc.sourceTruncated,
  };

  if (mode === "metadata") return base;

  if (!doc.text) {
    return { ...base, ok: false, reason: doc.reason ?? "no_readable_text" };
  }

  const sliced = sliceLines(doc.text, request.offset, request.limit);
  return {
    ...base,
    ok: true,
    text: sliced.text,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    totalLines: sliced.totalLines,
    hasMore: Boolean(sliced.hasMore || doc.sourceTruncated),
  };
}
