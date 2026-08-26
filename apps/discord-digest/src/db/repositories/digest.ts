import { and, desc, eq } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

export interface DigestConfig {
  id: string;
  name: string;
  channel: string;
  threadId: string;
  windowHours: number;
  style: string;
  sendAsBot: boolean;
  active: boolean;
  tzid: string;
  localTime: string;
  rrule: string;
  scheduleNote: string | null;
  githubRepos: string[];
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  lastScheduledAt: Date | null;
}

export interface DigestRun {
  id: string;
  configId: string | null;
  channel: string;
  threadId: string;
  windowHours: number;
  status: string;
  sent: boolean;
  summary: string | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

type ConfigInsert = typeof createAppDbSchema extends (prefix?: string) => infer T
  ? T extends { configs: infer C }
    ? C extends { $inferInsert: infer I }
      ? I
      : never
    : never
  : never;

type RunInsert = typeof createAppDbSchema extends (prefix?: string) => infer T
  ? T extends { runs: infer R }
    ? R extends { $inferInsert: infer I }
      ? I
      : never
    : never
  : never;

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseGithubRepos(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      }
    } catch {
      // fall through
    }
  }
  return [];
}

function hydrateConfig(row: Record<string, unknown> | undefined): DigestConfig | undefined {
  if (!row) return undefined;
  return { ...row, githubRepos: parseGithubRepos(row.githubRepos) } as DigestConfig;
}

export class DigestRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createAppDbSchema(tablePrefix);
  }

  listConfigs(): DigestConfig[] {
    const rows = this.db
      .select()
      .from(this.tables.configs)
      .where(eq(this.tables.configs.active, true))
      .orderBy(desc(this.tables.configs.updatedAt))
      .all() as Record<string, unknown>[];
    return rows.map((row) => hydrateConfig(row)!) ;
  }

  getConfig(id: string): DigestConfig | undefined {
    const row = this.db.select().from(this.tables.configs).where(eq(this.tables.configs.id, id)).get() as
      | Record<string, unknown>
      | undefined;
    return hydrateConfig(row);
  }

  /**
   * Active configs that target a given channel. Used to decide whether a
   * channel→agent binding is still needed after one digest on that channel is
   * deleted: if any other active config remains, the binding must stay.
   */
  listActiveConfigsForChannel(channel: string, threadId: string): DigestConfig[] {
    const rows = this.db
      .select()
      .from(this.tables.configs)
      .where(
        and(
          eq(this.tables.configs.active, true),
          eq(this.tables.configs.channel, channel),
          eq(this.tables.configs.threadId, threadId),
        ),
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => hydrateConfig(row)!);
  }

  upsertConfig(input: Partial<DigestConfig> & { threadId: string; name?: string }): DigestConfig {
    const now = new Date();
    const id = input.id ?? makeId();
    const existing = input.id ? this.getConfig(input.id) : undefined;
    const row: ConfigInsert = {
      id,
      name: input.name?.trim() || existing?.name || "Discord channel digest",
      channel: input.channel || existing?.channel || "discord",
      threadId: input.threadId.trim(),
      windowHours: Number(input.windowHours ?? existing?.windowHours ?? 24),
      style: input.style || existing?.style || "friendly",
      sendAsBot: Boolean(input.sendAsBot ?? existing?.sendAsBot ?? true),
      active: Boolean(input.active ?? existing?.active ?? true),
      tzid: input.tzid || existing?.tzid || "Asia/Shanghai",
      localTime: input.localTime || existing?.localTime || "09:00",
      rrule: input.rrule || existing?.rrule || "FREQ=DAILY;INTERVAL=1",
      scheduleNote: input.scheduleNote ?? existing?.scheduleNote ?? null,
      githubRepos: JSON.stringify(parseGithubRepos(input.githubRepos ?? existing?.githubRepos ?? [])),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt ?? null,
      lastScheduledAt: existing?.lastScheduledAt ?? null,
    };

    if (existing) {
      this.db.update(this.tables.configs).set(row).where(eq(this.tables.configs.id, id)).run();
    } else {
      this.db.insert(this.tables.configs).values(row).run();
    }
    return this.getConfig(id)!;
  }

  markConfigRun(id: string): void {
    const now = new Date();
    this.db
      .update(this.tables.configs)
      .set({ lastRunAt: now, updatedAt: now })
      .where(eq(this.tables.configs.id, id))
      .run();
  }

  markConfigScheduled(id: string, scheduleNote: string): void {
    const now = new Date();
    this.db
      .update(this.tables.configs)
      .set({ lastScheduledAt: now, scheduleNote, updatedAt: now })
      .where(eq(this.tables.configs.id, id))
      .run();
  }

  archiveConfig(id: string): DigestConfig | undefined {
    const existing = this.getConfig(id);
    if (!existing) return undefined;
    const now = new Date();
    this.db
      .update(this.tables.configs)
      .set({
        active: false,
        scheduleNote: "Deleted",
        updatedAt: now,
      })
      .where(eq(this.tables.configs.id, id))
      .run();
    return this.getConfig(id);
  }

  createRun(input: {
    configId?: string | null;
    channel: string;
    threadId: string;
    windowHours: number;
  }): DigestRun {
    const row: RunInsert = {
      id: makeId(),
      configId: input.configId ?? null,
      channel: input.channel,
      threadId: input.threadId,
      windowHours: input.windowHours,
      status: "in_progress",
      sent: false,
      summary: null,
      error: null,
      createdAt: new Date(),
      completedAt: null,
    };
    this.db.insert(this.tables.runs).values(row).run();
    return this.getRun(row.id)!;
  }

  finishRun(id: string, summary: string, sent: boolean): DigestRun {
    this.db
      .update(this.tables.runs)
      .set({ status: "completed", summary, sent, completedAt: new Date() })
      .where(eq(this.tables.runs.id, id))
      .run();
    return this.getRun(id)!;
  }

  markRunSent(id: string): DigestRun {
    this.db
      .update(this.tables.runs)
      .set({ sent: true, completedAt: new Date() })
      .where(eq(this.tables.runs.id, id))
      .run();
    return this.getRun(id)!;
  }

  failRun(id: string, error: string): DigestRun {
    this.db
      .update(this.tables.runs)
      .set({ status: "failed", error, completedAt: new Date() })
      .where(eq(this.tables.runs.id, id))
      .run();
    return this.getRun(id)!;
  }

  getRun(id: string): DigestRun | undefined {
    return this.db.select().from(this.tables.runs).where(eq(this.tables.runs.id, id)).get() as
      | DigestRun
      | undefined;
  }

  listRuns(limit = 20): DigestRun[] {
    return this.db
      .select()
      .from(this.tables.runs)
      .orderBy(desc(this.tables.runs.createdAt))
      .limit(limit)
      .all() as DigestRun[];
  }
}

export function createDigestRepository(ctx: AppDbContext): DigestRepository {
  return new DigestRepository(ctx.connection, ctx.tablePrefix);
}
