import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

export type TargetLevel = "beginner" | "intermediate" | "advanced";
export type MissionStatus = "active" | "paused" | "done";
export type LessonStatus = "planned" | "draft" | "published" | "completed";

export interface MissionRow {
  id: string;
  title: string;
  motivation: string;
  targetLevel: TargetLevel;
  notes: string;
  status: MissionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModuleRow {
  id: string;
  missionId: string;
  seq: number;
  title: string;
  objective: string;
  createdAt: Date;
}

export interface LessonRow {
  id: string;
  missionId: string;
  moduleId: string | null;
  seq: number;
  title: string;
  objective: string;
  html: string;
  summary: string;
  status: LessonStatus;
  errorNote: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** A planned module with its planned lessons — the shape the planner emits. */
export interface OutlineModuleInput {
  title: string;
  objective?: string;
  lessons: Array<{ title: string; objective?: string }>;
}

export type QuizType = "mcq" | "qa";

export interface CardRow {
  id: string;
  missionId: string;
  lessonId: string | null;
  front: string;
  back: string;
  /** Active-recall type. null = legacy/unclassified (treated as qa at review). */
  quizType: QuizType | null;
  /** Exactly 3 distractors for mcq cards; null for qa/unclassified. */
  options: string[] | null;
  ease: number;
  intervalDays: number;
  reps: number;
  dueAt: Date;
  createdAt: Date;
}

export interface ResourceRow {
  id: string;
  missionId: string | null;
  title: string;
  url: string;
  note: string;
  createdAt: Date;
}

export interface ReviewRow {
  id: string;
  cardId: string;
  grade: number;
  prevInterval: number;
  newInterval: number;
  prevEase: number | null;
  prevReps: number | null;
  quizType: QuizType | null;
  verdict: "correct" | "partial" | "wrong" | null;
  reviewedAt: Date;
}

export interface SettingsRow {
  id: string;
  defaultNotifyChannel: string;
  dailyReviewTime: string;
  timezone: string;
}

const SETTINGS_ID = "singleton";

export class TeachRepository {
  private readonly t;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.t = createAppDbSchema(tablePrefix);
  }

  // ── Missions ───────────────────────────────────────────────────────────────
  createMission(input: {
    title: string;
    motivation?: string;
    targetLevel?: TargetLevel;
    notes?: string;
  }): MissionRow {
    const now = new Date();
    const row = {
      id: crypto.randomUUID(),
      title: input.title,
      motivation: input.motivation ?? "",
      targetLevel: input.targetLevel ?? "beginner",
      notes: input.notes ?? "",
      status: "active" as MissionStatus,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(this.t.mission).values(row).run();
    return row;
  }

  getMission(id: string): MissionRow | null {
    return this.db.select().from(this.t.mission).where(eq(this.t.mission.id, id)).get() ?? null;
  }

  listMissions(): MissionRow[] {
    return this.db.select().from(this.t.mission).orderBy(desc(this.t.mission.createdAt)).all();
  }

  updateMission(
    id: string,
    patch: Partial<Pick<MissionRow, "title" | "motivation" | "targetLevel" | "notes" | "status">>,
  ): MissionRow | null {
    this.db
      .update(this.t.mission)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(this.t.mission.id, id))
      .run();
    return this.getMission(id);
  }

  // ── Lessons ──────────────────────────────────────────────────────────────────
  nextLessonSeq(missionId: string): number {
    const last = this.db
      .select()
      .from(this.t.lesson)
      .where(eq(this.t.lesson.missionId, missionId))
      .orderBy(desc(this.t.lesson.seq))
      .limit(1)
      .get();
    return (last?.seq ?? 0) + 1;
  }

  createLesson(input: {
    missionId: string;
    moduleId?: string | null;
    seq: number;
    title: string;
    objective?: string;
    html?: string;
    summary?: string;
    status?: LessonStatus;
    errorNote?: string | null;
  }): LessonRow {
    const row = {
      id: crypto.randomUUID(),
      missionId: input.missionId,
      moduleId: input.moduleId ?? null,
      seq: input.seq,
      title: input.title,
      objective: input.objective ?? "",
      html: input.html ?? "",
      summary: input.summary ?? "",
      status: input.status ?? ("draft" as LessonStatus),
      errorNote: input.errorNote ?? null,
      createdAt: new Date(),
      completedAt: null,
    };
    this.db.insert(this.t.lesson).values(row).run();
    return row;
  }

  getLesson(id: string): LessonRow | null {
    return this.db.select().from(this.t.lesson).where(eq(this.t.lesson.id, id)).get() ?? null;
  }

  listLessonsByMission(missionId: string): LessonRow[] {
    return this.db
      .select()
      .from(this.t.lesson)
      .where(eq(this.t.lesson.missionId, missionId))
      .orderBy(asc(this.t.lesson.seq))
      .all();
  }

  updateLesson(
    id: string,
    patch: Partial<
      Pick<LessonRow, "title" | "objective" | "html" | "summary" | "status" | "errorNote" | "completedAt">
    >,
  ): LessonRow | null {
    this.db.update(this.t.lesson).set(patch).where(eq(this.t.lesson.id, id)).run();
    return this.getLesson(id);
  }

  // ── Modules / syllabus ────────────────────────────────────────────────────────
  listModulesByMission(missionId: string): ModuleRow[] {
    return this.db
      .select()
      .from(this.t.module)
      .where(eq(this.t.module.missionId, missionId))
      .orderBy(asc(this.t.module.seq))
      .all();
  }

  /**
   * Replace (or seed) a mission's syllabus. Inserts the given modules and their
   * planned lessons after any already-realized content. When `regen` is set,
   * incomplete (still-`planned`) lessons and the modules left empty by their
   * removal are cleared first, so a re-plan never disturbs lessons the learner
   * has already started or completed.
   */
  saveOutline(
    missionId: string,
    modules: OutlineModuleInput[],
    opts: { regen?: boolean } = {},
  ): { moduleCount: number; lessonCount: number } {
    if (opts.regen) {
      // Drop not-yet-started lessons, then prune modules that became empty.
      this.db
        .delete(this.t.lesson)
        .where(and(eq(this.t.lesson.missionId, missionId), eq(this.t.lesson.status, "planned")))
        .run();
      const remaining = this.listLessonsByMission(missionId);
      const usedModuleIds = new Set(remaining.map((l) => l.moduleId).filter(Boolean) as string[]);
      for (const m of this.listModulesByMission(missionId)) {
        if (!usedModuleIds.has(m.id)) {
          this.db.delete(this.t.module).where(eq(this.t.module.id, m.id)).run();
        }
      }
    }

    const existingModules = this.listModulesByMission(missionId);
    let moduleSeq = existingModules.reduce((max, m) => Math.max(max, m.seq), 0);
    let lessonSeq = this.nextLessonSeq(missionId) - 1;
    const now = new Date();
    let moduleCount = 0;
    let lessonCount = 0;

    for (const mod of modules) {
      moduleSeq += 1;
      const moduleRow = {
        id: crypto.randomUUID(),
        missionId,
        seq: moduleSeq,
        title: mod.title,
        objective: mod.objective ?? "",
        createdAt: now,
      };
      this.db.insert(this.t.module).values(moduleRow).run();
      moduleCount += 1;
      for (const lsn of mod.lessons) {
        lessonSeq += 1;
        this.createLesson({
          missionId,
          moduleId: moduleRow.id,
          seq: lessonSeq,
          title: lsn.title,
          objective: lsn.objective ?? "",
          status: "planned",
        });
        lessonCount += 1;
      }
    }

    return { moduleCount, lessonCount };
  }

  // ── Cards ─────────────────────────────────────────────────────────────────────
  createCard(input: {
    missionId: string;
    lessonId?: string | null;
    front: string;
    back: string;
    quizType?: QuizType | null;
    options?: string[] | null;
    dueAt?: Date;
    ease?: number;
    intervalDays?: number;
    reps?: number;
  }): CardRow {
    const now = new Date();
    const row = {
      id: crypto.randomUUID(),
      missionId: input.missionId,
      lessonId: input.lessonId ?? null,
      front: input.front,
      back: input.back,
      quizType: input.quizType ?? null,
      options: input.options ?? null,
      ease: input.ease ?? 2.5,
      intervalDays: input.intervalDays ?? 0,
      reps: input.reps ?? 0,
      // New cards are immediately due so they enter the review queue.
      dueAt: input.dueAt ?? now,
      createdAt: now,
    };
    this.db.insert(this.t.card).values(row).run();
    return row;
  }

  getCard(id: string): CardRow | null {
    return this.db.select().from(this.t.card).where(eq(this.t.card.id, id)).get() ?? null;
  }

  listDueCards(now: Date = new Date()): CardRow[] {
    return this.db
      .select()
      .from(this.t.card)
      .where(lte(this.t.card.dueAt, now))
      .orderBy(asc(this.t.card.dueAt))
      .all();
  }

  listCardsByMission(missionId: string): CardRow[] {
    return this.db.select().from(this.t.card).where(eq(this.t.card.missionId, missionId)).all();
  }

  updateCardSchedule(
    id: string,
    patch: Pick<CardRow, "ease" | "intervalDays" | "reps" | "dueAt">,
  ): CardRow | null {
    this.db.update(this.t.card).set(patch).where(eq(this.t.card.id, id)).run();
    return this.getCard(id);
  }

  /** Set a card's active-recall type and distractor options (backfill / repair). */
  updateCardQuiz(
    id: string,
    patch: { quizType: QuizType; options: string[] | null },
  ): CardRow | null {
    this.db.update(this.t.card).set(patch).where(eq(this.t.card.id, id)).run();
    return this.getCard(id);
  }

  /** All cards, newest first (used by the backfill pass). */
  listAllCards(): CardRow[] {
    return this.db.select().from(this.t.card).orderBy(desc(this.t.card.createdAt)).all();
  }

  /** Cards that have not yet been classified into mcq/qa (quiz_type IS NULL). */
  listUnclassifiedCards(): CardRow[] {
    return this.listAllCards().filter((c) => c.quizType == null);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────────
  createReview(input: {
    cardId: string;
    grade: number;
    prevInterval: number;
    newInterval: number;
    prevEase?: number | null;
    prevReps?: number | null;
    quizType?: QuizType | null;
    verdict?: "correct" | "partial" | "wrong" | null;
  }): ReviewRow {
    const row = {
      id: crypto.randomUUID(),
      cardId: input.cardId,
      grade: input.grade,
      prevInterval: input.prevInterval,
      newInterval: input.newInterval,
      prevEase: input.prevEase ?? null,
      prevReps: input.prevReps ?? null,
      quizType: input.quizType ?? null,
      verdict: input.verdict ?? null,
      reviewedAt: new Date(),
    };
    this.db.insert(this.t.review).values(row).run();
    return row;
  }

  getReview(id: string): ReviewRow | null {
    return this.db.select().from(this.t.review).where(eq(this.t.review.id, id)).get() ?? null;
  }

  deleteReview(id: string): void {
    this.db.delete(this.t.review).where(eq(this.t.review.id, id)).run();
  }

  listReviews(limit = 1000): ReviewRow[] {
    return this.db
      .select()
      .from(this.t.review)
      .orderBy(desc(this.t.review.reviewedAt))
      .limit(limit)
      .all();
  }

  // ── Resources ─────────────────────────────────────────────────────────────────
  addResource(input: {
    missionId?: string | null;
    title: string;
    url?: string;
    note?: string;
  }): ResourceRow {
    const row = {
      id: crypto.randomUUID(),
      missionId: input.missionId ?? null,
      title: input.title,
      url: input.url ?? "",
      note: input.note ?? "",
      createdAt: new Date(),
    };
    this.db.insert(this.t.resource).values(row).run();
    return row;
  }

  listResources(missionId?: string | null): ResourceRow[] {
    const base = this.db.select().from(this.t.resource);
    const rows = missionId
      ? base.where(eq(this.t.resource.missionId, missionId)).all()
      : base.all();
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ── Learning records ────────────────────────────────────────────────────────
  addLearningRecord(input: {
    missionId: string;
    lessonId?: string | null;
    content: string;
  }): void {
    this.db
      .insert(this.t.learningRecord)
      .values({
        id: crypto.randomUUID(),
        missionId: input.missionId,
        lessonId: input.lessonId ?? null,
        content: input.content,
        createdAt: new Date(),
      })
      .run();
  }

  listLearningRecordsByMission(missionId: string) {
    return this.db
      .select()
      .from(this.t.learningRecord)
      .where(eq(this.t.learningRecord.missionId, missionId))
      .orderBy(desc(this.t.learningRecord.createdAt))
      .all();
  }

  // ── Settings (singleton) ──────────────────────────────────────────────────────
  getSettings(): SettingsRow {
    const existing = this.db
      .select()
      .from(this.t.appSettings)
      .where(eq(this.t.appSettings.id, SETTINGS_ID))
      .get();
    if (existing) return existing;
    const row: SettingsRow = {
      id: SETTINGS_ID,
      defaultNotifyChannel: "webchat",
      dailyReviewTime: "09:00",
      timezone: "UTC",
    };
    this.db.insert(this.t.appSettings).values(row).run();
    return row;
  }

  updateSettings(patch: Partial<Omit<SettingsRow, "id">>): SettingsRow {
    const current = this.getSettings(); // ensure row exists
    // drizzle's .set({}) throws "No values to set"; skip the write when there's
    // nothing to change (e.g. a routine-only reconcile passes no settings fields).
    if (Object.keys(patch).length === 0) return current;
    this.db.update(this.t.appSettings).set(patch).where(eq(this.t.appSettings.id, SETTINGS_ID)).run();
    return this.getSettings();
  }

  // ── Aggregates ────────────────────────────────────────────────────────────────
  countDueByMission(now: Date = new Date()): Map<string, number> {
    const rows = this.db
      .select()
      .from(this.t.card)
      .where(lte(this.t.card.dueAt, now))
      .all();
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.missionId, (map.get(r.missionId) ?? 0) + 1);
    return map;
  }
}

export function createTeachRepository(ctx: AppDbContext): TeachRepository {
  return new TeachRepository(ctx.connection, ctx.tablePrefix);
}
