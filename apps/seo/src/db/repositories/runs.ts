import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { AppDbContext } from "@rome-os/app-runtime";
import { runs, type SeoRun } from "../schema.js";

export function createRunsRepository(db: AppDbContext) {
  const connection = db.connection;
  return {
    get: (id: string) =>
      connection.select().from(runs).where(eq(runs.id, id)).get(),
    list: () =>
      connection
        .select({
          id: runs.id,
          kind: runs.kind,
          workflow: runs.workflow,
          title: runs.title,
          status: runs.status,
          createdAt: runs.createdAt,
          completedAt: runs.completedAt,
          error: runs.error,
        })
        .from(runs)
        .orderBy(desc(runs.createdAt))
        .limit(200)
        .all(),
    insert: (row: typeof runs.$inferInsert) =>
      connection.insert(runs).values(row).run(),
    update: (id: string, patch: Partial<SeoRun>) =>
      connection.update(runs).set(patch).where(eq(runs.id, id)).run(),
    delete: (id: string) =>
      connection.delete(runs).where(eq(runs.id, id)).run(),
    activeCount: () =>
      connection
        .select({ id: runs.id })
        .from(runs)
        .where(inArray(runs.status, ["pending", "running"]))
        .all().length,
    // An interrupted daemon must not leave a perpetual spinner. No automatic AI retries.
    expireInterrupted: () =>
      connection
        .update(runs)
        .set({
          status: "failed",
          error: "Run interrupted or exceeded 30 minutes. Re-run to try again.",
          completedAt: Date.now(),
        })
        .where(
          and(
            inArray(runs.status, ["pending", "running"]),
            lt(runs.createdAt, Date.now() - 30 * 60_000),
          ),
        )
        .run(),
  };
}
