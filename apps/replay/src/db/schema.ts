import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Replay data model. Three records:
 *  - `traces`   — one uploaded trace.json per row, with parsed summary fields
 *                 and the raw block array kept verbatim for export + replay.
 *  - `plans`    — an ordered list of trace ids; the order IS the replay order.
 *  - `sessions` — binds a webchat session to a plan and tracks the replay cursor.
 *
 * Logical names only; the daemon joins the `replay__` prefix.
 */
export function createAppDbSchema(tablePrefix: string = "replay") {
  // One uploaded trace.json. `contentJson` is the original `TraceBlockDto[]`
  // text, stored as-is so it can be re-exported byte-for-byte and replayed
  // block-by-block. The remaining columns are a parsed summary for the list UI.
  const traces = sqliteTable(
    `${tablePrefix}__traces`,
    {
      id: text("id").primaryKey(),
      /** Display name — defaults to the uploaded file name, user-renamable. */
      name: text("name").notNull(),
      uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
      sizeBytes: integer("size_bytes").notNull(),
      /** Total blocks in the trace array (all types, not just emittable ones). */
      blockCount: integer("block_count").notNull(),
      /** Recorded user prompt (turn_start.userPrompt, fallback session_init). */
      originalUserPrompt: text("original_user_prompt"),
      /** turn_end.status: "completed" | "interrupted" | "error". */
      status: text("status"),
      /** result/error accounting.model, when present. */
      model: text("model"),
      /** Turn wall-clock (turn_end.durationMs, fallback accounting.durationMs). */
      durationMs: integer("duration_ms"),
      /** Raw TraceBlockDto[] JSON text — the source of truth for replay+export. */
      contentJson: text("content_json").notNull(),
    },
    (t) => [index(`${tablePrefix}__traces_uploaded_idx`).on(t.uploadedAt)],
  );

  // A replay plan: an ordered set of trace ids plus playback settings.
  // `traceIdsJson` is a JSON array of trace ids; its order is the order the
  // traces replay in.
  const plans = sqliteTable(`${tablePrefix}__plans`, {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    traceIdsJson: text("trace_ids_json").notNull(),
    /** Playback speed multiplier — every pacing delay is divided by it. */
    speed: real("speed").notNull().default(1),
    /** Wall-clock typewriter budget per turn (ms); past it, blocks emit instantly. */
    turnBudgetMs: integer("turn_budget_ms").notNull().default(30_000),
  });

  // Binds a webchat session to a plan and tracks how far replay has advanced.
  // `cursor` is the index into the plan's trace list of the NEXT trace to play;
  // the turn-middleware reads it each turn, replays that trace, then increments.
  const sessions = sqliteTable(`${tablePrefix}__sessions`, {
    sessionId: text("session_id").primaryKey(),
    planId: text("plan_id").notNull(),
    cursor: integer("cursor").notNull().default(0),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  });

  return { traces, plans, sessions };
}

const defaultSchema = createAppDbSchema();
export const traces = defaultSchema.traces;
export const plans = defaultSchema.plans;
export const sessions = defaultSchema.sessions;
