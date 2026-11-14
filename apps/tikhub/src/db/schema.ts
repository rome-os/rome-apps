import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "tikhub") {
  /** App-scoped key/value settings (API key, base URL, request tuning). */
  const settings = sqliteTable(`${tablePrefix}__settings`, {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  });

  /** Cached remote documents: the OpenAPI schema and the endpoint price list. */
  const cache = sqliteTable(`${tablePrefix}__cache`, {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  });

  /** One row per TikHub request made through the app (agent or UI). */
  const calls = sqliteTable(
    `${tablePrefix}__calls`,
    {
      id: text("id").primaryKey(),
      createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
      finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
      source: text("source").notNull(), // agent | ui
      method: text("method").notNull(),
      path: text("path").notNull(),
      tag: text("tag"),
      platform: text("platform"),
      status: text("status").notNull(), // pending | ok | error | blocked | dry_run
      httpStatus: integer("http_status"),
      durationMs: integer("duration_ms"),
      attempts: integer("attempts"),
      requestJson: text("request_json"),
      requestId: text("request_id"),
      costUsd: real("cost_usd"),
      errorMessage: text("error_message"),
      /** Structured, language-neutral message (src/lib/messages.ts); re-rendered per language. */
      errorJson: text("error_json"),
      responsePreview: text("response_preview"),
      responseBytes: integer("response_bytes"),
    },
    (t) => [index(`${tablePrefix}__calls_created_idx`).on(t.createdAt)],
  );

  return { settings, cache, calls };
}

const defaultSchema = createAppDbSchema();

export const settings = defaultSchema.settings;
export const cache = defaultSchema.cache;
export const calls = defaultSchema.calls;
