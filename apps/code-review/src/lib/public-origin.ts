/**
 * Rome exposes no public-origin setting to actions, so the dashboard API
 * remembers the origin the guardian opens it on. Reviews use it to link back
 * to the PR history page from the GitHub review footer. Every instance learns
 * its own origin this way; nothing is hard-coded.
 */
export const PUBLIC_ORIGIN_SETTING = "public_origin";

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  return value?.split(",")[0].trim() || undefined;
}

/**
 * The external origin of a dashboard request, mirroring Rome core's
 * getExternalRequestOrigin: host from X-Forwarded-Host or Host; protocol is
 * HTTPS for Rome Cloud hosts (`*.<PANTHEON_DOMAIN>`, whose edge forwards plain
 * http), otherwise X-Forwarded-Proto, otherwise http. Loopback hosts return
 * null because a link to them is useless to anyone else.
 */
export function publicOriginFromHeaders(
  headers: Record<string, string | undefined>,
  cloudDomain: string | undefined = process.env.PANTHEON_DOMAIN,
): string | null {
  const host = (header(headers, "x-forwarded-host") ?? header(headers, "host"))?.toLowerCase();
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/.test(host)) return null;
  const hostname = host.replace(/:\d+$/, "");
  if (hostname === "localhost" || hostname === "0.0.0.0" || /^127\./.test(hostname)) return null;

  const domain = cloudDomain?.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  const isCloudHost = !!domain && (hostname === domain || hostname.endsWith(`.${domain}`));
  const forwardedProto = header(headers, "x-forwarded-proto")?.toLowerCase();
  const protocol = isCloudHost ? "https" : forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  return `${protocol}://${host}`;
}

/**
 * The origin to remember from a dashboard request, or null. Only a guardian
 * signed in through the browser may set it: the saved origin is published in
 * GitHub reviews under the bot's identity, and visitors, anonymous callers,
 * and loopback tools can all choose the Host headers they send.
 */
export function originToRemember(request: {
  caller: { kind: string; via?: string };
  headers: Record<string, string | undefined>;
}): string | null {
  if (request.caller.kind !== "guardian" || request.caller.via !== "cookie") return null;
  return publicOriginFromHeaders(request.headers);
}

/** Absolute link to the app's history page for one repo + PR pair. */
export function prHistoryUrl(origin: string, repo: string, prNumber: number): string {
  const [owner, name] = repo.split("/");
  return `${origin}/apps/code-review/pr/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${prNumber}`;
}
