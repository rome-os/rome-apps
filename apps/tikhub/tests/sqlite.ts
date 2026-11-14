/** Test-only adapter: Node's built-in SQLite, no native package installation. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";

export function testDb(filename = ":memory:", migrate = true) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA busy_timeout=5000");
  if (migrate) for (const name of ["0000_mature_gabe_jones.sql", "0001_fat_wallop.sql"]) sqlite.exec(readFileSync(join(process.cwd(), "src/db/migrations", name), "utf8"));
  const adapter = {
    prepare(text: string) {
      const stmt = sqlite.prepare(text);
      const rows = (array: boolean) => ({
        get(...args: unknown[]) { stmt.setReturnArrays(array); return stmt.get(...args as never[]); },
        all(...args: unknown[]) { stmt.setReturnArrays(array); return stmt.all(...args as never[]); },
      });
      return { ...rows(false), raw: () => rows(true), run: (...args: unknown[]) => stmt.run(...args as never[]) };
    },
    transaction<T>(fn: (tx: unknown) => T) {
      const run = (behavior: string) => (tx: unknown) => {
        sqlite.exec("BEGIN " + behavior);
        try { const value = fn(tx); sqlite.exec("COMMIT"); return value; }
        catch (err) { sqlite.exec("ROLLBACK"); throw err; }
      };
      return { deferred: run("DEFERRED"), immediate: run("IMMEDIATE"), exclusive: run("EXCLUSIVE") };
    },
  };
  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(adapter as never, dialect, undefined);
  const connection = new BaseSQLiteDatabase("sync", dialect, session, undefined) as unknown as DrizzleDb;
  return { db: { tablePrefix: "tikhub", connection } as AppDbContext, sqlite, close: () => sqlite.close() };
}
