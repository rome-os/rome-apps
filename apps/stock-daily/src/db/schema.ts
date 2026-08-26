import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "stock_daily") {
  const schedules = sqliteTable(`${tablePrefix}__schedules`, {
    id: text("id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    tzid: text("tzid").notNull(),
    localTime: text("local_time").notNull(),
    frequency: text("frequency").notNull(),
    weekday: text("weekday"),
    rrule: text("rrule").notNull(),
    eventName: text("event_name"),
    eventId: text("event_id"),
    /** Legacy — replaced by sendEmail; kept because SQLite column drops need a table rebuild. */
    sendWechat: integer("send_wechat", { mode: "boolean" }).notNull().default(false),
    sendEmail: integer("send_email", { mode: "boolean" }).notNull().default(false),
    emailRecipient: text("email_recipient"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    deactivatedAt: integer("deactivated_at", { mode: "timestamp" }),
  });

  const reports = sqliteTable(`${tablePrefix}__reports`, {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id"),
    status: text("status").notNull(),
    triggerType: text("trigger_type").notNull(),
    reportDate: text("report_date").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    content: text("content"),
    sourcesJson: text("sources_json"),
    error: text("error"),
    pdfPath: text("pdf_path"),
    pdfSizeBytes: integer("pdf_size_bytes"),
    pdfError: text("pdf_error"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  const settings = sqliteTable(`${tablePrefix}__settings`, {
    key: text("key").primaryKey(),
    value: text("value"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  return { schedules, reports, settings };
}

const defaultSchema = createAppDbSchema();

export const schedules = defaultSchema.schedules;
export const reports = defaultSchema.reports;
export const settings = defaultSchema.settings;
