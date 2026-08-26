import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "discord_digest") {
  const configs = sqliteTable(`${tablePrefix}__configs`, {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("discord"),
    threadId: text("thread_id").notNull(),
    windowHours: integer("window_hours").notNull().default(24),
    style: text("style").notNull().default("friendly"),
    sendAsBot: integer("send_as_bot", { mode: "boolean" }).notNull().default(true),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    tzid: text("tzid").notNull().default("Asia/Shanghai"),
    localTime: text("local_time").notNull().default("09:00"),
    rrule: text("rrule").notNull().default("FREQ=DAILY;INTERVAL=1"),
    scheduleNote: text("schedule_note"),
    githubRepos: text("github_repos"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    lastScheduledAt: integer("last_scheduled_at", { mode: "timestamp" }),
  });

  const runs = sqliteTable(`${tablePrefix}__runs`, {
    id: text("id").primaryKey(),
    configId: text("config_id"),
    channel: text("channel").notNull().default("discord"),
    threadId: text("thread_id").notNull(),
    windowHours: integer("window_hours").notNull(),
    status: text("status").notNull(),
    sent: integer("sent", { mode: "boolean" }).notNull().default(false),
    summary: text("summary"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  });

  return { configs, runs };
}

const defaultSchema = createAppDbSchema();

export const configs = defaultSchema.configs;
export const runs = defaultSchema.runs;
