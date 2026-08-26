import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "x") {
  const actionRuns = sqliteTable(`${tablePrefix}__action_runs`, {
    id: text("id").primaryKey(),
    actionName: text("action_name").notNull(),
    status: text("status").notNull().default("running"),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  });

  const accountState = sqliteTable(`${tablePrefix}__account_state`, {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    bio: text("bio"),
    followers: text("followers"),
    following: text("following"),
    tweets: text("tweets"),
    loginStatus: text("login_status").notNull().default("unknown"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  const brandVoices = sqliteTable(`${tablePrefix}__brand_voices`, {
    id: text("id").primaryKey(),
    accountHandle: text("account_handle").notNull(),
    isOwn: integer("is_own").notNull().default(1),
    learnStatus: text("learn_status").notNull().default("idle"),
    learnProgress: integer("learn_progress").notNull().default(0),
    memoryFilePath: text("memory_file_path"),
    sourceAccounts: text("source_accounts"),
    tweetsAnalyzed: integer("tweets_analyzed").notNull().default(0),
    lastLearnedAt: integer("last_learned_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  return { actionRuns, accountState, brandVoices };
}

const defaultSchema = createAppDbSchema();
export const actionRuns = defaultSchema.actionRuns;
export const accountState = defaultSchema.accountState;
export const brandVoices = defaultSchema.brandVoices;
