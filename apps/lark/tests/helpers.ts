import { DatabaseSync } from "node:sqlite";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readdirSync, readFileSync } from "node:fs";
import type { RomeAppContext } from "@rome-os/app-runtime";
export function testContext() {
  const native = new DatabaseSync(":memory:");
  for (const file of readdirSync(
    new URL("../src/db/migrations/", import.meta.url),
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    native.exec(
      readFileSync(
        new URL(`../src/db/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  const client = {
    prepare(sql: string) {
      const s = native.prepare(sql);
      const wrapper = {
        raw() {
          s.setReturnArrays(true);
          return wrapper;
        },
        run(...params: unknown[]) {
          return s.run(...(params as never[]));
        },
        all(...params: unknown[]) {
          return s.all(...(params as never[]));
        },
        get(...params: unknown[]) {
          return s.get(...(params as never[]));
        },
      };
      return wrapper;
    },
    transaction<T>(callback: (tx: unknown) => T) {
      const run = (tx: unknown) => {
        native.exec("BEGIN IMMEDIATE");
        try {
          const result = callback(tx);
          native.exec("COMMIT");
          return result;
        } catch (e) {
          native.exec("ROLLBACK");
          throw e;
        }
      };
      return Object.assign(run, {
        deferred: run,
        immediate: run,
        exclusive: run,
      });
    },
  };
  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(client as never, dialect, undefined);
  const database = new BaseSQLiteDatabase("sync", dialect, session, undefined);
  const ctx = {
    app: { id: "lark", version: "0.1.0", description: "test" },
    db: {
      connection: database,
      tablePrefix: "lark",
      tableName: (name: string) => `lark__${name}`,
    },
    repositories: { settings: { get: async () => null, set: async () => {} } },
    runAction: async () => ({ status: "ok" as const, data: {} }),
  } as unknown as RomeAppContext;
  return { ctx, native };
}
export const guardian = {
  channelContext: {
    channel: "feishu",
    threadId: "private",
    threadType: "private" as const,
    senderBondLevel: "guardian",
  },
};
