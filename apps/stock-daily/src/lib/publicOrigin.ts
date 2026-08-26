import type { RomeAppApiRequest } from "@rome-os/app-runtime";

function readHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  const direct = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  return undefined;
}

export function normalizeOrigin(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (/^127\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;

  const match = host.match(/^172\.(\d{1,2})\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}

export function isShareableOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

export function configuredShareableOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = normalizeOrigin(env.ROME_PUBLIC_ORIGIN) ?? normalizeOrigin(env.PANTHEON_INSTANCE_ORIGIN);
  if (isShareableOrigin(explicit)) return explicit;

  const slug = env.PANTHEON_SLUG?.trim();
  const domain = env.PANTHEON_DOMAIN?.trim().replace(/^\.+|\.+$/g, "");
  if (slug && domain) {
    const derived = normalizeOrigin(`https://${slug}.${domain}`);
    if (isShareableOrigin(derived)) return derived;
  }

  return undefined;
}

export function requestOrigin(request: RomeAppApiRequest): string | undefined {
  const originHeader = normalizeOrigin(readHeader(request.headers, "Origin"));
  if (originHeader) return originHeader;

  const forwardedHost = readHeader(request.headers, "X-Forwarded-Host");
  if (forwardedHost) {
    const forwardedProto = readHeader(request.headers, "X-Forwarded-Proto");
    const proto = (forwardedProto ?? "https").split(",")[0]?.trim() || "https";
    const host = forwardedHost.split(",")[0]?.trim();
    return normalizeOrigin(host ? `${proto}://${host}` : undefined);
  }

  const host = readHeader(request.headers, "Host");
  if (!host) return undefined;
  const hostname = host.split(":")[0] ?? host;
  const proto = isPrivateHostname(hostname) ? "http" : "https";
  return normalizeOrigin(`${proto}://${host}`);
}

/**
 * Origin suitable for a browser currently talking to this API.
 *
 * Prefer a configured public instance origin so links copied/sent out of the
 * app are reachable from phones and chat clients. Fall back to request headers
 * for local/self-hosted use.
 */
export function downloadOriginForRequest(
  request: RomeAppApiRequest,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return configuredShareableOrigin(env) ?? requestOrigin(request);
}

/**
 * Origin safe to persist for scheduled/out-of-band notifications.
 *
 * Never persist loopback/private origins: a local dashboard request should not
 * poison the next email with a 127.0.0.1 URL.
 */
export function shareableOriginForRequest(
  request: RomeAppApiRequest,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = configuredShareableOrigin(env);
  if (configured) return configured;
  const observed = requestOrigin(request);
  return isShareableOrigin(observed) ? observed : undefined;
}
