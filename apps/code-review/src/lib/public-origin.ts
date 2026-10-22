/**
 * Rome exposes no public-origin setting to actions, so the dashboard API
 * remembers the HTTPS origin the guardian opens it on. Reviews use it to link
 * back to the PR history page from the GitHub review footer.
 */
export const PUBLIC_ORIGIN_SETTING = "public_origin";

/** The public HTTPS origin from proxy request headers, or null for local/invalid hosts. */
export function publicOriginFromHeaders(headers: Record<string, string | undefined>): string | null {
  const raw = headers["x-forwarded-host"] || headers["X-Forwarded-Host"] || headers["host"] || headers["Host"];
  const host = raw?.split(",")[0].trim().toLowerCase();
  if (!host || /^(127\.|localhost|0\.0\.0\.0|\[::1\])/.test(host)) return null;
  // The edge proxy serves public hosts over HTTPS even when it forwards plain http.
  const origin = `https://${host}`;
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin) ? origin : null;
}

/** Absolute link to the app's history page for one repo + PR pair. */
export function prHistoryUrl(origin: string, repo: string, prNumber: number): string {
  const [owner, name] = repo.split("/");
  return `${origin}/apps/code-review/pr/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${prNumber}`;
}
