import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDbContext } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";
import { LarkError } from "../../lib/policy.js";
export interface Preferences {
  brand: "feishu" | "lark";
  agentEnabled: boolean;
  writesEnabled: boolean;
  revision: number;
}
export function createRepository(context: AppDbContext) {
  const db = context.connection;
  const { settings, invocations, setupJobs } = createAppDbSchema(
    context.tablePrefix,
  );
  function preferences(): Preferences {
    const row = db.select().from(settings).where(eq(settings.id, 1)).get();
    return {
      brand: row?.brand === "lark" ? "lark" : "feishu",
      agentEnabled: row?.agentEnabled ?? true,
      writesEnabled: row?.writesEnabled ?? true,
      revision: row?.revision ?? 0,
    };
  }
  return {
    preferences,
    updatePreferences(patch: Partial<Preferences>): Preferences {
      const current = preferences();
      db.insert(settings)
        .values({
          id: 1,
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: settings.id,
          set: { ...patch, updatedAt: new Date().toISOString() },
        })
        .run();
      return preferences();
    },
    reserve(row: typeof invocations.$inferInsert, expectedRevision?: number) {
      return db.transaction((tx) => {
        if (
          tx
            .select()
            .from(setupJobs)
            .where(eq(setupJobs.state, "running"))
            .get()
        )
          throw new LarkError("setup_in_progress");
        const current = tx
          .select()
          .from(settings)
          .where(eq(settings.id, 1))
          .get();
        if (
          expectedRevision !== undefined &&
          (current?.revision ?? 0) !== expectedRevision
        )
          throw new LarkError("connection_changed_refresh_status");
        if (current?.agentEnabled === false)
          throw new LarkError("agent_access_disabled");
        if (row.risk === "write" && current?.writesEnabled === false)
          throw new LarkError("writes_disabled");
        const existing = tx
          .select()
          .from(invocations)
          .where(eq(invocations.id, row.id))
          .get();
        if (existing) {
          if (existing.fingerprint !== row.fingerprint)
            throw new LarkError("request_id_conflict");
          return existing;
        }
        tx.insert(invocations).values(row).run();
        return undefined;
      });
    },
    finish(
      id: string,
      state: "completed" | "failed" | "unknown",
      errorCode?: string,
    ) {
      db.update(invocations)
        .set({
          state,
          errorCode: errorCode ?? null,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(invocations.id, id))
        .run();
    },
    activity(limit = 50) {
      return db
        .select({
          id: invocations.id,
          connectionId: invocations.connectionId,
          authorizationRevision: invocations.authorizationRevision,
          command: invocations.command,
          identity: invocations.identity,
          risk: invocations.risk,
          state: invocations.state,
          errorCode: invocations.errorCode,
          createdAt: invocations.createdAt,
          finishedAt: invocations.finishedAt,
        })
        .from(invocations)
        .orderBy(desc(invocations.createdAt))
        .limit(limit)
        .all();
    },
    job(id: string) {
      return db.select().from(setupJobs).where(eq(setupJobs.id, id)).get();
    },
    latestJob() {
      return db
        .select()
        .from(setupJobs)
        .orderBy(desc(setupJobs.createdAt))
        .limit(1)
        .get();
    },
    beginJob(id: string, kind: string) {
      db.transaction((tx) => {
        if (
          tx
            .select()
            .from(setupJobs)
            .where(eq(setupJobs.state, "running"))
            .get() ||
          tx
            .select()
            .from(invocations)
            .where(eq(invocations.state, "running"))
            .get()
        )
          throw new LarkError("operation_in_progress");
        tx.insert(settings)
          .values({ id: 1, revision: 1, updatedAt: new Date().toISOString() })
          .onConflictDoUpdate({
            target: settings.id,
            set: {
              revision: sql`${settings.revision} + 1`,
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
        tx.insert(setupJobs)
          .values({
            id,
            kind,
            state: "running",
            createdAt: new Date().toISOString(),
          })
          .run();
      });
    },
    finishJob(id: string, state: string, errorCode?: string) {
      db.update(setupJobs)
        .set({
          state,
          errorCode: errorCode ?? null,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(setupJobs.id, id))
        .run();
    },
    recoverInterrupted() {
      db.update(invocations)
        .set({
          state: "unknown",
          errorCode: "runtime_restarted",
          finishedAt: new Date().toISOString(),
        })
        .where(
          and(eq(invocations.state, "running"), eq(invocations.risk, "write")),
        )
        .run();
      db.update(invocations)
        .set({
          state: "failed",
          errorCode: "runtime_restarted",
          finishedAt: new Date().toISOString(),
        })
        .where(eq(invocations.state, "running"))
        .run();
      db.update(setupJobs)
        .set({
          state: "interrupted",
          errorCode: "runtime_restarted",
          finishedAt: new Date().toISOString(),
        })
        .where(eq(setupJobs.state, "running"))
        .run();
    },
  };
}
export type LarkRepository = ReturnType<typeof createRepository>;
