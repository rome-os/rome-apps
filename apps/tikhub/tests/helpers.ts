import type { CallInsert, CallRow, Repositories } from "../src/db/repositories/index.js";

export { fixtureDoc as loadDoc, fixturePrices as loadPrices } from "./fixtures.js";

/** In-memory stand-ins for the Drizzle repositories. */
export function memoryRepos(): Repositories & { rows: Map<string, CallRow> } {
  const settings = new Map<string, string>();
  const cache = new Map<string, { value: string; fetchedAt: Date }>();
  const rows = new Map<string, CallRow>();
  const blank: Omit<CallRow, "id" | "createdAt" | "source" | "method" | "path" | "status"> = {
    finishedAt: null, tag: null, platform: null, httpStatus: null, durationMs: null, attempts: null,
    requestJson: null, requestId: null, costUsd: null, errorMessage: null, errorJson: null, responsePreview: null, responseBytes: null,
  };
  const repos = {
    rows,
    settings: {
      getAll: () => Object.fromEntries(settings),
      set: (k: string, v: string) => void settings.set(k, v),
      delete: (k: string) => void settings.delete(k),
    },
    cache: {
      get: (k: string) => cache.get(k) ?? null,
      fetchedAt: (k: string) => cache.get(k)?.fetchedAt ?? null,
      set: (k: string, v: string) => void cache.set(k, { value: v, fetchedAt: new Date() }),
      tryAcquireRequestSlot: () => 0, // Boundary stub; real SQLite coordination is tested separately.
      acquireRequestLease: () => ({ key: "synthetic-lease", owner: "synthetic-owner" }),
      releaseRequestLease: () => {},
    },
    calls: {
      insert: (r: CallInsert) => void rows.set(r.id, { ...blank, ...r } as CallRow),
      update: (id: string, patch: Partial<CallInsert>) => void rows.set(id, { ...rows.get(id)!, ...patch } as CallRow),
      byId: (id: string) => rows.get(id) ?? null,
      list: () => ({ total: rows.size, items: [...rows.values()] }),
      since: (d: Date) => [...rows.values()].filter((r) => r.createdAt >= d),
      aggregateSince: (d: Date, offsetMs: number) => [...rows.values()].filter((r) => r.createdAt >= d).map((r) => ({
        day: Math.floor((r.createdAt.getTime() + offsetMs) / 86400000), platform: r.platform, status: r.status, n: 1,
        costUsd: r.costUsd ?? 0, unknownCosts: r.costUsd === null && !["blocked", "dry_run"].includes(r.status) ? 1 : 0,
      })),
      failStale: () => 0,
    },
  };
  return repos as unknown as Repositories & { rows: Map<string, CallRow> };
}

export interface FakeCall { url: string; init: RequestInit }

export function fakeFetch(handler: (url: URL, init: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> } | Error) {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    const r = handler(url, init);
    if (r instanceof Error) throw r;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { impl, calls };
}
