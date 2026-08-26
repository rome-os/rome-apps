import { desc, eq } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

export interface RawSource {
  source: string;
  content: string;
}

export interface SummaryReport {
  id: string;
  period: string;
  periodLabel: string;
  windowHours: number;
  report: string;
  rawSources: RawSource[];
  sourcesCollected: number;
  wechatSent: boolean;
  createdAt: Date;
}

export interface SummaryReportListItem {
  id: string;
  period: string;
  periodLabel: string;
  /** First ~120 chars of the report for preview */
  preview: string;
  sourcesCollected: number;
  wechatSent: boolean;
  createdAt: Date;
}

export class ReportsRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createAppDbSchema(tablePrefix);
  }

  async save(data: {
    period: string;
    periodLabel: string;
    windowHours: number;
    report: string;
    rawSources: RawSource[];
    sourcesCollected: number;
    wechatSent: boolean;
  }): Promise<SummaryReport> {
    const id = crypto.randomUUID();
    const createdAt = new Date();
    this.db
      .insert(this.tables.reports)
      .values({
        id,
        period: data.period,
        periodLabel: data.periodLabel,
        windowHours: data.windowHours,
        report: data.report,
        rawSources: JSON.stringify(data.rawSources),
        sourcesCollected: data.sourcesCollected,
        wechatSent: data.wechatSent,
        createdAt,
      })
      .run();
    return {
      id,
      ...data,
      createdAt,
    };
  }

  async list(limit = 50): Promise<SummaryReportListItem[]> {
    const rows = this.db
      .select()
      .from(this.tables.reports)
      .orderBy(desc(this.tables.reports.createdAt))
      .limit(limit)
      .all();

    return rows.map((row) => ({
      id: row.id,
      period: row.period,
      periodLabel: row.periodLabel,
      preview: row.report.slice(0, 120) + (row.report.length > 120 ? "…" : ""),
      sourcesCollected: row.sourcesCollected,
      wechatSent: row.wechatSent,
      createdAt: row.createdAt,
    }));
  }

  async getById(id: string): Promise<SummaryReport | null> {
    const rows = this.db
      .select()
      .from(this.tables.reports)
      .where(eq(this.tables.reports.id, id))
      .limit(1)
      .all();

    if (rows.length === 0) return null;
    const row = rows[0];

    let rawSources: RawSource[] = [];
    try {
      rawSources = JSON.parse(row.rawSources) as RawSource[];
    } catch {
      rawSources = [];
    }

    return {
      id: row.id,
      period: row.period,
      periodLabel: row.periodLabel,
      windowHours: row.windowHours,
      report: row.report,
      rawSources,
      sourcesCollected: row.sourcesCollected,
      wechatSent: row.wechatSent,
      createdAt: row.createdAt,
    };
  }
}

export function createReportsRepository(ctx: AppDbContext): ReportsRepository {
  return new ReportsRepository(ctx.connection, ctx.tablePrefix);
}
