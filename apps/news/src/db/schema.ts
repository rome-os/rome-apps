import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createNewsDbSchema(tablePrefix: string = "news") {
  const redditPosts = sqliteTable(`${tablePrefix}__reddit_posts`, {
    id: text("id").primaryKey(),
    redditPostId: text("reddit_post_id").notNull().unique(),
    title: text("title").notNull(),
    subreddit: text("subreddit").notNull(),
    author: text("author").notNull(),
    score: integer("score").notNull(),
    numComments: integer("num_comments").notNull(),
    permalink: text("permalink").notNull(),
    selftext: text("selftext"),
    searchQuery: text("search_query").notNull(),
    scanName: text("scan_name").notNull(),
    createdUtc: integer("created_utc", { mode: "timestamp" }).notNull(),
    discoveredAt: integer("discovered_at", { mode: "timestamp" }).notNull(),
  });

  return { redditPosts };
}

const defaultSchema = createNewsDbSchema();

export const redditPosts = defaultSchema.redditPosts;
