import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppDbContext } from "@rome-os/app-runtime";
import { reports, schedules, settings } from "../schema.js";

export const SETTING_KEY_PUBLIC_ORIGIN = "public_origin";
export const SETTING_KEY_CUSTOM_PROMPT = "custom_prompt";

/** Hard cap on the saved custom prompt size to avoid pathological input. */
export const CUSTOM_PROMPT_MAX_LENGTH = 8000;

export type ScheduleRecord = typeof schedules.$inferSelect;
export type NewScheduleRecord = typeof schedules.$inferInsert;
export type ReportRecord = typeof reports.$inferSelect;
export type NewReportRecord = typeof reports.$inferInsert;

export function createStockDailyRepository(db: AppDbContext) {
  const connection = db.connection;

  return {
    getActiveSchedule(): ScheduleRecord | undefined {
      return connection
        .select()
        .from(schedules)
        .where(and(eq(schedules.enabled, true), isNull(schedules.deactivatedAt)))
        .orderBy(desc(schedules.updatedAt))
        .limit(1)
        .get();
    },

    getSchedule(id: string): ScheduleRecord | undefined {
      return connection.select().from(schedules).where(eq(schedules.id, id)).limit(1).get();
    },

    listReports(limit = 12): ReportRecord[] {
      return connection.select().from(reports).orderBy(desc(reports.createdAt)).limit(limit).all();
    },

    getReport(id: string): ReportRecord | undefined {
      return connection.select().from(reports).where(eq(reports.id, id)).limit(1).get();
    },

    deactivateActiveSchedules(now = new Date()): void {
      connection
        .update(schedules)
        .set({ enabled: false, deactivatedAt: now, updatedAt: now })
        .where(and(eq(schedules.enabled, true), isNull(schedules.deactivatedAt)))
        .run();
    },

    createSchedule(row: NewScheduleRecord): void {
      connection.insert(schedules).values(row).run();
    },

    updateSchedule(id: string, patch: Partial<NewScheduleRecord>): void {
      connection.update(schedules).set(patch).where(eq(schedules.id, id)).run();
    },

    createReport(row: NewReportRecord): void {
      connection.insert(reports).values(row).run();
    },

    updateReport(id: string, patch: Partial<NewReportRecord>): void {
      connection.update(reports).set(patch).where(eq(reports.id, id)).run();
    },

    getSetting(key: string): string | undefined {
      const row = connection
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1)
        .get();
      return row?.value ?? undefined;
    },

    setSetting(key: string, value: string | null, now: Date = new Date()): void {
      connection
        .insert(settings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: now },
        })
        .run();
    },

    /**
     * Return the saved custom prompt, or undefined when none is stored.
     * Empty / whitespace-only values are treated as "not set".
     */
    getCustomPrompt(): string | undefined {
      const row = connection
        .select()
        .from(settings)
        .where(eq(settings.key, SETTING_KEY_CUSTOM_PROMPT))
        .limit(1)
        .get();
      const value = row?.value ?? undefined;
      if (!value || !value.trim()) return undefined;
      return value;
    },

    /**
     * Persist (or clear) the saved custom prompt. Pass null/undefined/""
     * to clear the saved prompt. Values are capped at CUSTOM_PROMPT_MAX_LENGTH.
     */
    setCustomPrompt(value: string | null | undefined, now: Date = new Date()): void {
      const normalized =
        typeof value === "string" && value.trim().length > 0
          ? value.slice(0, CUSTOM_PROMPT_MAX_LENGTH)
          : null;
      connection
        .insert(settings)
        .values({ key: SETTING_KEY_CUSTOM_PROMPT, value: normalized, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: normalized, updatedAt: now },
        })
        .run();
    },
  };
}
