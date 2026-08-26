import { fetchAppApi } from "@rome-os/app-web-sdk";
import type { GithubUserProfile, RepositoryData } from "@/types";
import { TRIGGER_SETTINGS_ROUTE } from "./constants";

/** Build a compact page list with ellipses, e.g. [1, "...", 4, 5, 6, "...", 20]. */
export function buildPageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

/** Compact "13m ago" / "2h ago" / "3d ago" relative time for the repo cards & feed. */
export function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "never";
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return "never";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

/** The GitHub owner (org/user) portion of an `owner/repo` full name. */
export function repoOwner(fullName: string): string {
  return (fullName || "").split("/")[0] || fullName;
}

export function getRouteReviewId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/apps\/code-review\/([^/?#]+)\/?$/);
  // A single trailing segment. Exclude the settings route and the two-segment
  // `task/<id>` route (which ends in `<id>` but is preceded by `task/`).
  if (!match?.[1] || match[1] === TRIGGER_SETTINGS_ROUTE) return null;
  if (/\/apps\/code-review\/task\/[^/?#]+\/?$/.test(window.location.pathname)) return null;
  return decodeURIComponent(match[1]);
}

/** The mention-task detail route: /apps/code-review/task/<taskId>. */
export function getRouteMentionTaskId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/apps\/code-review\/task\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function isTriggerSettingsRoute(): boolean {
  if (typeof window === "undefined") return false;
  return new RegExp(`/apps/code-review/${TRIGGER_SETTINGS_ROUTE}/?$`).test(window.location.pathname);
}

export function getTriggerSettingsRepoParam(): string | null {
  if (typeof window === "undefined") return null;
  const repo = new URLSearchParams(window.location.search).get("repo");
  return repo?.trim() || null;
}

export function getAppBasePath(): string {
  if (typeof window === "undefined") return "";
  // Strip anything after the app root, regardless of how many trailing segments
  // (e.g. `/task/<id>`), so deep detail routes resolve the base correctly.
  const match = window.location.pathname.match(/^(.*\/apps\/code-review)(?:\/|$)/);
  return match?.[1] || window.location.pathname;
}

export function normalizeGithubLoginInput(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function normalizeGithubLogins(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeGithubLoginInput).filter(Boolean)));
}

export function getRepositoryHref(repo: RepositoryData): string {
  if (/^https?:\/\//i.test(repo.url)) return repo.url;
  return `https://github.com/${repo.name || repo.url}`;
}

export function githubInitials(login: string, name?: string | null): string {
  const source = (name || login).trim();
  if (!source) return "?";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const GITHUB_USER_PROFILE_CACHE_KEY = "code-review.githubUserProfiles.v1";
const GITHUB_USER_PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedGithubUserProfile = {
  profile: GithubUserProfile;
  expiresAt: number;
};

const githubUserProfileRequests = new Map<string, Promise<GithubUserProfile>>();

function readGithubUserProfileCache(): Record<string, CachedGithubUserProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GITHUB_USER_PROFILE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, CachedGithubUserProfile> : {};
  } catch {
    return {};
  }
}

function writeGithubUserProfileCache(cache: Record<string, CachedGithubUserProfile>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GITHUB_USER_PROFILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota/private-mode failures; the in-flight request cache still dedupes per page session.
  }
}

function getCachedGithubUserProfile(login: string): GithubUserProfile | null {
  const normalized = normalizeGithubLoginInput(login);
  if (!normalized) return null;
  const cache = readGithubUserProfileCache();
  const cached = cache[normalized];
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.profile;
}

function cacheGithubUserProfile(login: string, profile: GithubUserProfile): void {
  const normalized = normalizeGithubLoginInput(login);
  const canonical = normalizeGithubLoginInput(profile.login);
  if (!normalized || !canonical) return;
  const cache = readGithubUserProfileCache();
  const entry = {
    profile,
    expiresAt: Date.now() + GITHUB_USER_PROFILE_CACHE_TTL_MS,
  };
  cache[normalized] = entry;
  cache[canonical] = entry;
  writeGithubUserProfileCache(cache);
}

/**
 * Normalize an `avatars.githubusercontent.com` URL to a single canonical size
 * so the same login always resolves to one browser-cache entry regardless of
 * where it is displayed. `s` is the pixel size the CDN renders (we request 2×
 * for retina); the CDN URL already carries `?v=4`.
 */
export function withAvatarSize(avatarUrl: string, size = 160): string {
  try {
    const url = new URL(avatarUrl);
    url.searchParams.set("s", String(size));
    return url.toString();
  } catch {
    return avatarUrl;
  }
}

/**
 * Synchronously read a resolved avatar URL from the localStorage cache, if
 * present and unexpired. Lets a component seed its initial `<img src>` without a
 * round-trip — so a previously-seen avatar paints instantly instead of flashing
 * the silhouette placeholder. Returns null on a cache miss.
 */
export function peekGithubAvatarUrl(login: string, size = 160): string | null {
  const cached = getCachedGithubUserProfile(login);
  if (!cached?.avatarUrl) return null;
  return withAvatarSize(cached.avatarUrl, size);
}

export async function fetchGithubUserProfile(login: string, options: { forceRefresh?: boolean } = {}): Promise<GithubUserProfile> {
  const normalized = normalizeGithubLoginInput(login);
  if (!normalized) throw new Error("Enter a GitHub login.");

  if (!options.forceRefresh) {
    const cached = getCachedGithubUserProfile(normalized);
    if (cached) return cached;

    const inFlight = githubUserProfileRequests.get(normalized);
    if (inFlight) return inFlight;
  }

  const request = (async () => {
    const response = await fetchAppApi(`github-users/${encodeURIComponent(normalized)}`);
    const data = (await response.json().catch(() => ({}))) as {
      user?: GithubUserProfile;
      error?: string;
    };
    if (!response.ok || !data.user) {
      throw new Error(data.error || `Failed to load @${normalized}`);
    }
    cacheGithubUserProfile(normalized, data.user);
    return data.user;
  })();

  githubUserProfileRequests.set(normalized, request);
  try {
    return await request;
  } finally {
    githubUserProfileRequests.delete(normalized);
  }
}
