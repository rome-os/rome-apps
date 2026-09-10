import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Teach app data model (design spec §4). All tables are namespaced by the
// app's tablePrefix inside the shared system SQLite. Logical names only here —
// the daemon joins the prefix as `teach__<name>`.
export function createAppDbSchema(tablePrefix: string = "teach") {
  // A learning Mission: what + why the guardian is learning.
  const mission = sqliteTable(`${tablePrefix}__mission`, {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    motivation: text("motivation").notNull().default(""),
    targetLevel: text("target_level", {
      enum: ["beginner", "intermediate", "advanced"],
    })
      .notNull()
      .default("beginner"),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: ["active", "paused", "done"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  // A module / chapter: the upper layer of a mission's two-level syllabus.
  // Modules are a read-only grouping produced by the syllabus-planner; lessons
  // point back to their module via moduleId.
  const module = sqliteTable(`${tablePrefix}__module`, {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  // A bite-sized, self-contained HTML lesson within a mission.
  const lesson = sqliteTable(`${tablePrefix}__lesson`, {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    // The module this lesson belongs to (syllabus grouping). NULL for legacy
    // lessons created before the syllabus addendum.
    moduleId: text("module_id"),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull().default(""),
    html: text("html").notNull().default(""),
    summary: text("summary").notNull().default(""),
    // 'planned' lessons are syllabus entries with a title+objective but no
    // content yet; they are realized (generated) just-in-time into draft →
    // published as the learner advances.
    status: text("status", { enum: ["planned", "draft", "published", "completed"] })
      .notNull()
      .default("draft"),
    // Optional note explaining a draft/fallback (e.g. web/LLM failure, spec §9).
    errorNote: text("error_note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  });

  // A spaced-repetition card (SM-2 lite state lives here).
  const card = sqliteTable(`${tablePrefix}__card`, {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    lessonId: text("lesson_id"),
    front: text("front").notNull(),
    back: text("back").notNull(),
    // Active-recall review type (spec §10b). NULL means "not yet classified"
    // (legacy cards created before the addendum) — the backfill pass sets it.
    // New cards always carry a concrete value.
    quizType: text("quiz_type", { enum: ["mcq", "qa"] }),
    // For mcq cards: JSON array of exactly 3 distractors (the correct answer is
    // `back`). NULL for qa cards (and unclassified cards).
    options: text("options", { mode: "json" }).$type<string[] | null>(),
    ease: real("ease").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  // A log of each review attempt against a card.
  const review = sqliteTable(`${tablePrefix}__review`, {
    id: text("id").primaryKey(),
    cardId: text("card_id").notNull(),
    grade: integer("grade").notNull(), // 0..3
    prevInterval: integer("prev_interval").notNull(),
    newInterval: integer("new_interval").notNull(),
    // Pre-review scheduling snapshot (spec §10b) — lets the "too easy → Easy"
    // bump cleanly REVISE a just-committed review instead of double-applying
    // SM-2. Nullable for legacy rows written before the addendum.
    prevEase: real("prev_ease"),
    prevReps: integer("prev_reps"),
    // What was reviewed and how it was judged (active recall).
    quizType: text("quiz_type", { enum: ["mcq", "qa"] }),
    verdict: text("verdict", { enum: ["correct", "partial", "wrong"] }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }).notNull(),
  });

  // A curated external source (citation), optionally tied to a mission.
  const resource = sqliteTable(`${tablePrefix}__resource`, {
    id: text("id").primaryKey(),
    missionId: text("mission_id"),
    title: text("title").notNull(),
    url: text("url").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  // An insight / note about what was learned.
  const learningRecord = sqliteTable(`${tablePrefix}__learning_record`, {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    lessonId: text("lesson_id"),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  // Singleton settings row (id is always "singleton").
  const appSettings = sqliteTable(`${tablePrefix}__app_settings`, {
    id: text("id").primaryKey(),
    // The single app-global channel for review nudges (telegram/whatsapp/wechat/
    // discord/webchat/email). Column name kept as default_notify_channel for
    // migration simplicity; semantically it is now the only channel setting.
    defaultNotifyChannel: text("default_notify_channel").notNull().default("webchat"),
    dailyReviewTime: text("daily_review_time").notNull().default("09:00"),
    // IANA timezone for the daily routine (extension beyond spec §4 — needed
    // because create_routine requires a tzid; defaults to UTC).
    timezone: text("timezone").notNull().default("UTC"),
  });

  return { mission, module, lesson, card, review, resource, learningRecord, appSettings };
}

const defaultSchema = createAppDbSchema();

export const mission = defaultSchema.mission;
export const module = defaultSchema.module;
export const lesson = defaultSchema.lesson;
export const card = defaultSchema.card;
export const review = defaultSchema.review;
export const resource = defaultSchema.resource;
export const learningRecord = defaultSchema.learningRecord;
export const appSettings = defaultSchema.appSettings;
