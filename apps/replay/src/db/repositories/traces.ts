import { desc, eq, inArray } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

/** A trace row without its (potentially large) raw content — for list views. */
export interface TraceSummaryRow {
  id: string;
  name: string;
  uploadedAt: Date;
  sizeBytes: number;
  blockCount: number;
  originalUserPrompt: string | null;
  status: string | null;
  model: string | null;
  durationMs: number | null;
}

/** A full trace row, including the raw `TraceBlockDto[]` text. */
export interface TraceRow extends TraceSummaryRow {
  contentJson: string;
}

export interface NewTrace {
  name: string;
  sizeBytes: number;
  blockCount: number;
  originalUserPrompt: string | null;
  status: string | null;
  model: string | null;
  durationMs: number | null;
  contentJson: string;
}

export class TracesRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createAppDbSchema(tablePrefix);
  }

  private summarySelect() {
    return {
      id: this.tables.traces.id,
      name: this.tables.traces.name,
      uploadedAt: this.tables.traces.uploadedAt,
      sizeBytes: this.tables.traces.sizeBytes,
      blockCount: this.tables.traces.blockCount,
      originalUserPrompt: this.tables.traces.originalUserPrompt,
      status: this.tables.traces.status,
      model: this.tables.traces.model,
      durationMs: this.tables.traces.durationMs,
    };
  }

  async list(): Promise<TraceSummaryRow[]> {
    return this.db
      .select(this.summarySelect())
      .from(this.tables.traces)
      .orderBy(desc(this.tables.traces.uploadedAt))
      .all() as TraceSummaryRow[];
  }

  async summaryById(id: string): Promise<TraceSummaryRow | undefined> {
    return this.db
      .select(this.summarySelect())
      .from(this.tables.traces)
      .where(eq(this.tables.traces.id, id))
      .get() as TraceSummaryRow | undefined;
  }

  /** Resolve summaries for a set of ids, preserving the input order. */
  async summariesByIds(ids: string[]): Promise<TraceSummaryRow[]> {
    if (ids.length === 0) return [];
    const rows = (await this.db
      .select(this.summarySelect())
      .from(this.tables.traces)
      .where(inArray(this.tables.traces.id, ids))
      .all()) as TraceSummaryRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async byId(id: string): Promise<TraceRow | undefined> {
    return this.db.select().from(this.tables.traces).where(eq(this.tables.traces.id, id)).get() as
      | TraceRow
      | undefined;
  }

  async insert(input: NewTrace): Promise<TraceSummaryRow> {
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      uploadedAt: new Date(),
      sizeBytes: input.sizeBytes,
      blockCount: input.blockCount,
      originalUserPrompt: input.originalUserPrompt,
      status: input.status,
      model: input.model,
      durationMs: input.durationMs,
      contentJson: input.contentJson,
    };
    this.db.insert(this.tables.traces).values(row).run();
    const { contentJson: _ignored, ...summary } = row;
    void _ignored;
    return summary;
  }

  async rename(id: string, name: string): Promise<TraceSummaryRow | undefined> {
    const existing = await this.summaryById(id);
    if (!existing) return undefined;
    this.db.update(this.tables.traces).set({ name }).where(eq(this.tables.traces.id, id)).run();
    return { ...existing, name };
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.summaryById(id);
    if (!existing) return false;
    this.db.delete(this.tables.traces).where(eq(this.tables.traces.id, id)).run();
    return true;
  }
}

export function createTracesRepository(ctx: AppDbContext): TracesRepository {
  return new TracesRepository(ctx.connection, ctx.tablePrefix);
}
