import type { ActivityCounts, ActivityItem, DashboardData, GhAuthStatus } from "@/types";

/**
 * Bump when the shape of {@link CachedHomeData} changes in a way older cached
 * blobs can't satisfy. This is the belt-and-suspenders guard for shape drift
 * during development within a single app version; across published versions the
 * `appVersion` envelope already invalidates automatically.
 */
const CACHE_SCHEMA_VERSION = 1;

const CACHE_KEY = "code-review.home.v1";

/** The first-screen payload we snapshot so a returning visit paints instantly. */
export interface CachedHomeData {
  dashboard: DashboardData;
  ghAuth: GhAuthStatus | null;
  activity: {
    items: ActivityItem[];
    total: number;
    counts: ActivityCounts | null;
  };
}

interface CacheEnvelope {
  schema: number;
  /** The app version that produced this blob — any upgrade auto-invalidates it. */
  appVersion: string;
  savedAt: number;
  data: CachedHomeData;
}

/**
 * Read the cached first screen, but only when it is safe to trust:
 * the schema and the app version must both match. There is deliberately no
 * time-based TTL — this app's data is append-mostly (reviews accrue, rarely
 * disappear), so a slightly stale snapshot is always corrected by the
 * background revalidation, never wrong enough to matter. Version mismatch is the
 * only invalidation, so a new API/app version never renders an old schema.
 */
export function readHomeCache(appVersion: string): CachedHomeData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env || env.schema !== CACHE_SCHEMA_VERSION || env.appVersion !== appVersion) return null;
    if (!env.data?.dashboard) return null;
    return env.data;
  } catch {
    return null;
  }
}

export function writeHomeCache(appVersion: string, data: CachedHomeData): void {
  if (typeof window === "undefined") return;
  try {
    const env: CacheEnvelope = {
      schema: CACHE_SCHEMA_VERSION,
      appVersion,
      savedAt: Date.now(),
      data,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(env));
  } catch {
    // Ignore quota / private-mode failures; the cache is a best-effort optimization.
  }
}
