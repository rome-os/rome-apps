import { eq, sql } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

export interface ReplaySession {
  sessionId: string;
  planId: string;
  cursor: number;
  startedAt: Date;
}

export class SessionsRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createAppDbSchema(tablePrefix);
  }

  /** Bind a webchat session to a plan, starting the cursor at 0. Idempotent on
   *  re-bind (the binding row is replaced) so a re-entry resets progress. */
  async bind(sessionId: string, planId: string): Promise<ReplaySession> {
    const row = { sessionId, planId, cursor: 0, startedAt: new Date() };
    this.db
      .insert(this.tables.sessions)
      .values(row)
      .onConflictDoUpdate({
        target: this.tables.sessions.sessionId,
        set: { planId, cursor: 0, startedAt: row.startedAt },
      })
      .run();
    return row;
  }

  async get(sessionId: string): Promise<ReplaySession | undefined> {
    return this.db
      .select()
      .from(this.tables.sessions)
      .where(eq(this.tables.sessions.sessionId, sessionId))
      .get() as ReplaySession | undefined;
  }

  /** Atomically advance the cursor by one and return the new value. */
  async advanceCursor(sessionId: string): Promise<void> {
    this.db
      .update(this.tables.sessions)
      .set({ cursor: sql`${this.tables.sessions.cursor} + 1` })
      .where(eq(this.tables.sessions.sessionId, sessionId))
      .run();
  }
}

export function createSessionsRepository(ctx: AppDbContext): SessionsRepository {
  return new SessionsRepository(ctx.connection, ctx.tablePrefix);
}
