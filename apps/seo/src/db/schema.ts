import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable(
  "seo__runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["check", "workflow"] }).notNull(),
    workflow: text("workflow"),
    title: text("title").notNull(),
    input: text("input", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    }).notNull(),
    result: text("result", { mode: "json" }).$type<
      import("../lib/page-check.js").PageCheck | null
    >(),
    report: text("report"),
    sessionId: text("session_id"),
    executionId: text("execution_id"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [index("seo_runs_created_idx").on(t.createdAt)],
);
export type SeoRun = typeof runs.$inferSelect;
