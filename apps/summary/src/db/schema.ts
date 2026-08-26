import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "summary") {
  const reports = sqliteTable(`${tablePrefix}__reports`, {
    id: text("id").primaryKey(),
    period: text("period").notNull(),
    periodLabel: text("period_label").notNull(),
    windowHours: integer("window_hours").notNull(),
    report: text("report").notNull(),
    /** JSON-encoded array of { source, content } collected from all channels */
    rawSources: text("raw_sources").notNull(),
    sourcesCollected: integer("sources_collected").notNull(),
    wechatSent: integer("wechat_sent", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  return { reports };
}

const defaultSchema = createAppDbSchema();

export const reports = defaultSchema.reports;
