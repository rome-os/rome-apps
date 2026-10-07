import type { RomeAppApiRequest } from "@rome-os/app-runtime";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export type Json = Record<string, unknown>;

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function body(request: RomeAppApiRequest): Json {
  if (!request.body || request.body.byteLength === 0) return {};
  try {
    const value = JSON.parse(new TextDecoder().decode(request.body));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Invalid JSON body.");
}

export function text(value: unknown, label: string, max: number, options: { required?: boolean } = {}): string {
  if (value === undefined || value === null) {
    if (options.required) throw new HttpError(400, `${label} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const out = value.trim();
  if (options.required && !out) throw new HttpError(400, `${label} is required.`);
  if (out.length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`);
  return out;
}

export function email(value: unknown): string {
  const out = text(value, "Email", 254).toLowerCase();
  if (out && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out)) throw new HttpError(400, "Enter a valid email address.");
  return out;
}

export function date(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, "Due date must be YYYY-MM-DD.");
  }
  return value;
}

export function url(value: unknown): string {
  const out = text(value, "Website", 300);
  if (!out) return "";
  const withScheme = /^https?:\/\//i.test(out) ? out : `https://${out}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("bad scheme");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new HttpError(400, "Enter a valid website link.");
  }
}
