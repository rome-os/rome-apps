import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export function createRedditDbSchema(tablePrefix: string = "reddit") {
  const redditAgentScanRuns = sqliteTable(
    `${tablePrefix}__agent_scan_runs`,
    {
      id: text("id").primaryKey(),
      scanName: text("scan_name").notNull(),
      status: text("status", {
        enum: ["running", "success", "partial", "error"],
      }).notNull(),
      queryCount: integer("query_count").notNull(),
      subredditCount: integer("subreddit_count").notNull(),
      scannedPairCount: integer("scanned_pair_count").notNull(),
      fetchedCount: integer("fetched_count").notNull(),
      insertedCount: integer("inserted_count").notNull(),
      updatedCount: integer("updated_count").notNull(),
      errorCount: integer("error_count").notNull(),
      errors: text("errors", { mode: "json" }).notNull(),
      startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
      finishedAt: integer("finished_at", { mode: "timestamp" }),
    },
    (table) => [
      index(`${tablePrefix}__agent_scan_runs__scan_name_idx`).on(table.scanName),
      index(`${tablePrefix}__agent_scan_runs__started_at_idx`).on(table.startedAt),
    ],
  );

  const redditAgentPosts = sqliteTable(
    `${tablePrefix}__agent_posts`,
    {
      id: text("id").primaryKey(),
      redditPostId: text("reddit_post_id").notNull(),
      title: text("title").notNull(),
      subreddit: text("subreddit").notNull(),
      author: text("author").notNull(),
      score: integer("score").notNull(),
      numComments: integer("num_comments").notNull(),
      permalink: text("permalink").notNull(),
      url: text("url"),
      selftext: text("selftext"),
      searchQuery: text("search_query").notNull(),
      scanName: text("scan_name").notNull(),
      createdUtc: integer("created_utc", { mode: "timestamp" }).notNull(),
      firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull(),
      lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
      seenCount: integer("seen_count").notNull().default(1),
      firstScanRunId: text("first_scan_run_id").notNull(),
      lastScanRunId: text("last_scan_run_id").notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__agent_posts__reddit_post_id_unique`).on(table.redditPostId),
      index(`${tablePrefix}__agent_posts__scan_name_idx`).on(table.scanName),
      index(`${tablePrefix}__agent_posts__subreddit_idx`).on(table.subreddit),
      index(`${tablePrefix}__agent_posts__last_seen_at_idx`).on(table.lastSeenAt),
      index(`${tablePrefix}__agent_posts__score_idx`).on(table.score),
    ],
  );

  return {
    redditAgentPosts,
    redditAgentScanRuns,
  };
}

const defaultSchema = createRedditDbSchema();

export const redditAgentPosts = defaultSchema.redditAgentPosts;
export const redditAgentScanRuns = defaultSchema.redditAgentScanRuns;
