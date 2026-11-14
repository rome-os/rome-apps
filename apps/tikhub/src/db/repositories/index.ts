import { and, desc, eq, getTableColumns, gte, like, sql, type SQL } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

type Tables = ReturnType<typeof createAppDbSchema>;

export function boundedPage(limit = 50, offset = 0): { limit: number; offset: number } {
  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50,
    offset: Number.isFinite(offset) ? Math.max(0, Math.min(1_000_000, Math.floor(offset))) : 0,
  };
}

export class SettingsRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly t: Tables,
  ) {}

  getAll(): Record<string, string> {
    const rows = this.db.select().from(this.t.settings).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  set(key: string, value: string): void {
    const now = new Date();
    this.db
      .insert(this.t.settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: this.t.settings.key, set: { value, updatedAt: now } })
      .run();
  }

  delete(key: string): void {
    this.db.delete(this.t.settings).where(eq(this.t.settings.key, key)).run();
  }
}

export class CacheRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly t: Tables,
  ) {}

  get(key: string): { value: string; fetchedAt: Date } | null {
    const row = this.db.select().from(this.t.cache).where(eq(this.t.cache.key, key)).get();
    return row ? { value: row.value, fetchedAt: row.fetchedAt } : null;
  }

  fetchedAt(key: string): Date | null {
    const row = this.db
      .select({ fetchedAt: this.t.cache.fetchedAt })
      .from(this.t.cache)
      .where(eq(this.t.cache.key, key))
      .get();
    return row?.fetchedAt ?? null;
  }

  set(key: string, value: string): void {
    const now = new Date();
    this.db
      .insert(this.t.cache)
      .values({ key, value, fetchedAt: now })
      .onConflictDoUpdate({ target: this.t.cache.key, set: { value, fetchedAt: now } })
      .run();
  }

  /** One SQLite immediate transaction coordinates API and action worker slots.
   * Uses only existing app-cache rows; no schema or credential migration. */
  reserveRequestSlot(path: string, qps: number, endpointQps: number, now: number): number {
    return this.db.transaction((tx) => {
      now = Math.max(now, Date.now()); // Recheck after waiting for SQLite's write lock.
      const globalKey = "rate:global";
      const endpointKey = "rate:" + path;
      const read = (key: string) => {
        const value = Number(tx.select({ value: this.t.cache.value }).from(this.t.cache).where(eq(this.t.cache.key, key)).get()?.value ?? 0);
        if (!Number.isFinite(value)) throw new Error("invalid rate state");
        return value;
      };
      const slot = Math.max(now, read(globalKey), read(endpointKey));
      if (slot > now + 30_000) throw new Error("request queue full");
      for (const [key, interval] of [[globalKey, 1000 / Math.max(1, Math.min(qps, 10))], [endpointKey, 1000 / Math.max(0.1, Math.min(endpointQps, 10))]] as const) {
        tx.insert(this.t.cache).values({ key, value: String(slot + interval), fetchedAt: new Date(now) })
          .onConflictDoUpdate({ target: this.t.cache.key, set: { value: String(slot + interval), fetchedAt: new Date(now) } }).run();
      }
      return slot;
    }, { behavior: "immediate" });
  }

  acquireRequestLease(durationMs: number, now: number): { key: string; owner: string } {
    return this.db.transaction((tx) => {
      now = Math.max(now, Date.now());
      for (let i = 0; i < 4; i++) {
        const key = "lease:" + i;
        const existing = tx.select({ value: this.t.cache.value }).from(this.t.cache).where(eq(this.t.cache.key, key)).get();
        const previous = existing ? JSON.parse(existing.value) as { expires: number } : null;
        if (previous && !Number.isFinite(previous.expires)) throw new Error("invalid lease state");
        if (previous && previous.expires > now) continue;
        const owner = crypto.randomUUID();
        const value = JSON.stringify({ owner, expires: now + durationMs });
        tx.insert(this.t.cache).values({ key, value, fetchedAt: new Date(now) })
          .onConflictDoUpdate({ target: this.t.cache.key, set: { value, fetchedAt: new Date(now) } }).run();
        return { key, owner };
      }
      throw new Error("request capacity full");
    }, { behavior: "immediate" });
  }

  releaseRequestLease(lease: { key: string; owner: string }): void {
    this.db.transaction((tx) => {
      const existing = tx.select({ value: this.t.cache.value }).from(this.t.cache).where(eq(this.t.cache.key, lease.key)).get();
      if (existing && (JSON.parse(existing.value) as { owner: string }).owner === lease.owner) tx.delete(this.t.cache).where(eq(this.t.cache.key, lease.key)).run();
    }, { behavior: "immediate" });
  }
}

export type CallRow = Tables["calls"]["$inferSelect"];
export type CallInsert = Tables["calls"]["$inferInsert"];

export interface CallListFilter {
  status?: string | null;
  platform?: string | null;
  source?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export class CallsRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly t: Tables,
  ) {}

  insert(row: CallInsert): void {
    this.db.insert(this.t.calls).values(row).run();
  }

  update(id: string, patch: Partial<CallInsert>): void {
    this.db.update(this.t.calls).set(patch).where(eq(this.t.calls.id, id)).run();
  }

  byId(id: string): CallRow | null {
    const c = this.t.calls;
    return this.db.select({ ...getTableColumns(c),
      requestJson: sql<string | null>`substr(${c.requestJson}, 1, 16000)`,
      responsePreview: sql<string | null>`substr(${c.responsePreview}, 1, 16000)`,
      errorMessage: sql<string | null>`substr(${c.errorMessage}, 1, 2000)`,
      errorJson: sql<string | null>`substr(${c.errorJson}, 1, 4000)`,
    }).from(c).where(eq(c.id, id)).get() ?? null;
  }

  list(filter: CallListFilter): { total: number; items: Omit<CallRow, "responsePreview">[] } {
    const page = boundedPage(filter.limit, filter.offset);
    const c = this.t.calls;
    const conds: SQL[] = [];
    if (filter.status) conds.push(eq(c.status, filter.status));
    if (filter.platform) conds.push(eq(c.platform, filter.platform));
    if (filter.source) conds.push(eq(c.source, filter.source));
    if (filter.q) conds.push(like(c.path, `%${filter.q}%`));
    const where = conds.length ? and(...conds) : undefined;
    const total = this.db.select({ n: sql<number>`count(*)` }).from(c).where(where).get()?.n ?? 0;
    const items = this.db
      .select({
        id: c.id,
        createdAt: c.createdAt,
        finishedAt: c.finishedAt,
        source: c.source,
        method: c.method,
        path: c.path,
        tag: c.tag,
        platform: c.platform,
        status: c.status,
        httpStatus: c.httpStatus,
        durationMs: c.durationMs,
        attempts: c.attempts,
        requestJson: sql<null>`null`, // Fetch request details only on the bounded single-record route.
        requestId: c.requestId,
        costUsd: c.costUsd,
        errorMessage: sql<string | null>`substr(${c.errorMessage}, 1, 2000)`,
        errorJson: sql<string | null>`substr(${c.errorJson}, 1, 4000)`,
        responseBytes: c.responseBytes,
      })
      .from(c)
      .where(where)
      .orderBy(desc(c.createdAt), desc(c.id))
      .limit(page.limit)
      .offset(page.offset)
      .all();
    return { total, items };
  }

  /** Per-day counts and estimated spend since `since` (local day buckets computed by caller). */
  since(since: Date): Array<Pick<CallRow, "createdAt" | "status" | "costUsd" | "platform">> {
    const c = this.t.calls;
    return this.db
      .select({ createdAt: c.createdAt, status: c.status, costUsd: c.costUsd, platform: c.platform })
      .from(c)
      .where(gte(c.createdAt, since))
      .all();
  }

  aggregateSince(since: Date, offsetMs: number) {
    const c = this.t.calls;
    const day = sql<number>`cast((${c.createdAt} + ${offsetMs}) / 86400000 as integer)`;
    return this.db.select({ day, status: c.status, platform: c.platform, n: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${c.costUsd}), 0)`,
      unknownCosts: sql<number>`sum(case when ${c.costUsd} is null and ${c.status} not in ('blocked','dry_run') then 1 else 0 end)`,
    }).from(c).where(gte(c.createdAt, since)).groupBy(day, c.status, c.platform).limit(20_000).all();
  }

  /** Mark rows stuck in `pending` (e.g. process restart mid-call) as failed. */
  failStale(olderThan: Date, message: { code: string }): number {
    const c = this.t.calls;
    const res = this.db
      .update(c)
      .set({ status: "error", errorMessage: "Interrupted before completion", errorJson: JSON.stringify(message), finishedAt: new Date() })
      .where(and(eq(c.status, "pending"), sql`${c.createdAt} < ${olderThan.getTime()}`))
      .run();
    return res.changes;
  }
}

export interface Repositories {
  settings: SettingsRepository;
  cache: CacheRepository;
  calls: CallsRepository;
}

export function createRepositories(ctx: AppDbContext): Repositories {
  const t = createAppDbSchema(ctx.tablePrefix);
  return {
    settings: new SettingsRepository(ctx.connection, t),
    cache: new CacheRepository(ctx.connection, t),
    calls: new CallsRepository(ctx.connection, t),
  };
}
