import { extname } from "node:path";
import { createAppLogger } from "@rome-os/app-runtime";

const log = createAppLogger("discord-digest_attachment_extract");

export const DEFAULT_LINE_LIMIT = 200;
const MAX_LINE_LIMIT = 2_000;
// Hard cap on characters returned per call, so a few very long lines can't
// flood the agent's context regardless of the requested line count.
const MAX_RETURN_CHARS = 20_000;
// Leading window we read from a text file. Large enough to page through most
// shared text/logs by line; files past this are reported as source-truncated.
const MAX_TEXT_READ_BYTES = 1024 * 1024;
// Binary documents (PDF/doc/docx) must be read whole to parse. Files above
// this are skipped entirely.
const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_FETCH_TIMEOUT_MS = 15_000;
const DOCUMENT_FETCH_TIMEOUT_MS = 30_000;

export interface AttachmentRef {
  url?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
}

export interface AttachmentLineResult {
  /** The selected lines joined with "\n", capped to MAX_RETURN_CHARS. */
  text: string;
  /** 1-based line number of the first returned line. */
  startLine: number;
  /** 1-based line number of the last returned line (inclusive). */
  endLine: number;
  /** Total lines available in the readable text (post source-truncation). */
  totalLines: number;
  /** True if more lines follow, or the source file itself was truncated. */
  hasMore: boolean;
  /** True if the underlying file exceeded our read cap and was cut short. */
  sourceTruncated: boolean;
}

interface FullText {
  text: string;
  // True when the underlying file was cut by a byte/size cap, so the text is
  // only a leading portion of the real file.
  truncated: boolean;
}

function fileExtension(fileName?: string): string {
  return extname(fileName ?? "").toLowerCase();
}

function isTextLikeAttachment(attachment: AttachmentRef): boolean {
  const mime = attachment.mimeType?.toLowerCase();
  if (mime?.startsWith("text/")) return true;
  if (
    mime &&
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/yaml",
      "application/x-yaml",
      "application/javascript",
      "application/typescript",
      "application/csv",
    ].includes(mime)
  ) {
    return true;
  }

  return new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".csv",
    ".tsv",
    ".xml",
    ".yaml",
    ".yml",
    ".log",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".css",
    ".html",
    ".sql",
  ]).has(fileExtension(attachment.fileName));
}

export function isAllowedDiscordAttachmentUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return (
    (host === "cdn.discordapp.com" || host === "media.discordapp.net") &&
    url.pathname.startsWith("/attachments/")
  );
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true; // NUL byte → definitely binary

  // Only count C0 control characters (excluding tab/newline/CR) as suspicious.
  // High bytes (> 126) must NOT count: valid UTF-8 multibyte sequences (CJK,
  // Cyrillic, Arabic, emoji, …) legitimately use the 0x80–0xFF range, and the
  // old byte>126 check misflagged any predominantly non-ASCII text as binary.
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32) control += 1;
  }
  if (sample.length > 0 && control / sample.length > 0.3) return true;

  // Validate the bytes decode as UTF-8. Trim any trailing bytes that may be a
  // multibyte sequence truncated at the sample boundary so we don't get a
  // false positive on otherwise-valid text.
  const validated = sample.length < buffer.length ? trimToUtf8Boundary(sample) : sample;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(validated);
  } catch {
    return true;
  }
  return false;
}

/**
 * Drop a trailing partial UTF-8 multibyte sequence from the end of a buffer
 * slice so strict UTF-8 validation isn't tripped by a character split at the
 * sampling cutoff. Removes at most the final 3 bytes.
 */
function trimToUtf8Boundary(sample: Buffer): Buffer {
  for (let i = sample.length - 1; i >= 0 && i >= sample.length - 3; i--) {
    const byte = sample[i];
    if ((byte & 0b1000_0000) === 0) return sample; // ASCII byte → boundary is clean
    if ((byte & 0b1100_0000) === 0b1100_0000) {
      // Lead byte: determine its expected sequence length.
      const expected = (byte & 0b1110_0000) === 0b1100_0000 ? 2 : (byte & 0b1111_0000) === 0b1110_0000 ? 3 : 4;
      const available = sample.length - i;
      return available >= expected ? sample : sample.subarray(0, i);
    }
    // else continuation byte (10xxxxxx) → keep scanning backwards
  }
  return sample;
}

function totalSizeFromContentRange(header: string | null): number | null {
  // e.g. "bytes 0-98303/500000" → 500000 ("*" means unknown).
  const match = header?.match(/\/(\d+)\s*$/u);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

async function fetchRemoteTextFull(attachment: AttachmentRef): Promise<FullText | null> {
  if (!attachment.url || !isTextLikeAttachment(attachment) || !isAllowedDiscordAttachmentUrl(attachment.url)) return null;

  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
    headers: { Range: `bytes=0-${MAX_TEXT_READ_BYTES - 1}` },
  }).catch(() => null);
  if (!response?.ok && response?.status !== 206) return null;

  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (contentType && !contentType.startsWith("text/") && !isTextLikeAttachment({ ...attachment, mimeType: contentType })) {
    return null;
  }

  let buffer = Buffer.from(await response.arrayBuffer());
  // The server may ignore Range and return the full body; cap to our window.
  let truncated = false;
  if (buffer.byteLength > MAX_TEXT_READ_BYTES) {
    buffer = buffer.subarray(0, MAX_TEXT_READ_BYTES);
    truncated = true;
  }
  // Otherwise, detect a truncated read from positive evidence of more content.
  const total = totalSizeFromContentRange(response.headers.get("content-range"));
  if (total !== null && total > buffer.byteLength) truncated = true;
  else if (total === null && typeof attachment.size === "number" && attachment.size > buffer.byteLength) truncated = true;

  if (buffer.length === 0 || looksBinary(buffer)) return null;
  // When the window is a leading slice, the cut may land mid-multibyte-char;
  // trim the dangling bytes so the text doesn't end in a replacement char.
  const clean = truncated ? trimToUtf8Boundary(buffer) : buffer;
  return { text: clean.toString("utf8"), truncated };
}

type DocumentKind = "pdf" | "docx" | "doc";

function documentKind(attachment: AttachmentRef): DocumentKind | null {
  const ext = fileExtension(attachment.fileName);
  const mime = attachment.mimeType?.toLowerCase() ?? "";
  if (ext === ".pdf" || mime === "application/pdf") return "pdf";
  if (
    ext === ".docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (ext === ".doc" || mime === "application/msword") return "doc";
  return null;
}

async function fetchRemoteDocumentBytes(attachment: AttachmentRef): Promise<Buffer | null> {
  if (!attachment.url || !isAllowedDiscordAttachmentUrl(attachment.url)) return null;
  if (typeof attachment.size === "number" && attachment.size > MAX_DOCUMENT_FILE_BYTES) return null;

  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(DOCUMENT_FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) return null;

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_FILE_BYTES) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_DOCUMENT_FILE_BYTES) return null;
  return buffer;
}

async function extractDocumentText(buffer: Buffer, kind: DocumentKind): Promise<string | null> {
  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const proxy = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(proxy, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : text;
    }
    if (kind === "docx") {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    const WordExtractor = (await import("word-extractor")).default;
    const doc = await new WordExtractor().extract(buffer);
    return doc.getBody();
  } catch (err) {
    log.warn("document text extraction failed", {
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// PDF/Word have no native line concept and cannot be partially parsed, so the
// whole document is downloaded and extracted; the caller line-slices the
// result. Stateless across calls (re-extracts each time).
async function readDocumentFullText(attachment: AttachmentRef): Promise<FullText | null> {
  const kind = documentKind(attachment);
  if (!kind) return null;

  const buffer = await fetchRemoteDocumentBytes(attachment);
  if (!buffer) return null;

  const raw = await extractDocumentText(buffer, kind);
  if (!raw) return null;

  const normalized = raw.replace(/\r\n/gu, "\n").replace(/[ \t]+\n/gu, "\n").trim();
  if (normalized.length === 0) return null;
  return { text: normalized, truncated: false };
}

/**
 * Read a line range from a Discord attachment URL, enabling the agent to page
 * through a file progressively. Handles PDF/Word documents and text-like
 * files; returns null when the attachment is an unsupported/binary type, is
 * inaccessible, or yields no readable text. The URL is validated against the
 * Discord CDN allow-list before any fetch.
 *
 * @param offset 1-based line to start at (default 1).
 * @param limit  maximum number of lines to return (default DEFAULT_LINE_LIMIT).
 */
export async function readAttachmentLines(
  attachment: AttachmentRef,
  offset: number = 1,
  limit: number = DEFAULT_LINE_LIMIT,
): Promise<AttachmentLineResult | null> {
  const full = (await readDocumentFullText(attachment)) ?? (await fetchRemoteTextFull(attachment));
  if (!full) return null;

  const lines = full.text.split("\n");
  const totalLines = lines.length;

  const start = Math.max(1, Math.floor(offset) || 1);
  const count = Math.max(1, Math.min(Math.floor(limit) || DEFAULT_LINE_LIMIT, MAX_LINE_LIMIT));
  const startIdx = Math.min(start - 1, totalLines); // clamp past-end to empty slice
  const endIdx = Math.min(startIdx + count, totalLines);

  const selected = lines.slice(startIdx, endIdx);
  let text = selected.join("\n");
  let charCapped = false;
  if (text.length > MAX_RETURN_CHARS) {
    text = `${text.slice(0, MAX_RETURN_CHARS).trim()}\n...[truncated — request fewer lines or a later offset]`;
    charCapped = true;
  }

  const startLine = selected.length > 0 ? startIdx + 1 : 0;
  const endLine = selected.length > 0 ? endIdx : 0;

  return {
    text,
    startLine,
    endLine,
    totalLines,
    hasMore: endIdx < totalLines || full.truncated || charCapped,
    sourceTruncated: full.truncated,
  };
}
