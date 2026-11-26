import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export function createAppDbSchema(prefix = "lark") {
  const settings = sqliteTable(`${prefix}__settings`, {
    id: integer("id").primaryKey(),
    brand: text("brand").notNull().default("feishu"),
    agentEnabled: integer("agent_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    writesEnabled: integer("writes_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    revision: integer("revision").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  });
  const invocations = sqliteTable(`${prefix}__invocations`, {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().default("local-cli"),
    authorizationRevision: text("authorization_revision"),
    fingerprint: text("fingerprint").notNull(),
    command: text("command").notNull(),
    identity: text("identity").notNull(),
    risk: text("risk").notNull(),
    state: text("state").notNull(),
    errorCode: text("error_code"),
    executionId: text("execution_id"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  });
  const setupJobs = sqliteTable(`${prefix}__setup_jobs`, {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  });
  return { settings, invocations, setupJobs };
}
export const { settings, invocations, setupJobs } = createAppDbSchema();
