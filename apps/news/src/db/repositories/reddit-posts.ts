import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createNewsDbSchema } from "../schema.js";

export interface RedditPostData {
  redditPostId: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  selftext?: string;
  searchQuery: string;
  scanName: string;
  createdUtc: Date;
}

export interface RedditPostsQueryOptions {
  since?: Date;
  subreddit?: string;
  scanName?: string;
  search?: string;
  limit?: number;
}

export class RedditPostsRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createNewsDbSchema(tablePrefix);
  }

  async upsert(data: RedditPostData): Promise<boolean> {
    const result = this.db
      .insert(this.tables.redditPosts)
      .values({
        id: uuid(),
        redditPostId: data.redditPostId,
        title: data.title,
        subreddit: data.subreddit,
        author: data.author,
        score: data.score,
        numComments: data.numComments,
        permalink: data.permalink,
        selftext: data.selftext ?? null,
        searchQuery: data.searchQuery,
        scanName: data.scanName,
        createdUtc: data.createdUtc,
        discoveredAt: new Date(),
      })
      .onConflictDoNothing({ target: this.tables.redditPosts.redditPostId })
      .run();

    return (result as { changes: number }).changes > 0;
  }

  async bulkUpsert(posts: RedditPostData[]): Promise<number> {
    let newCount = 0;
    for (const post of posts) {
      const isNew = await this.upsert(post);
      if (isNew) {
        newCount += 1;
      }
    }
    return newCount;
  }

  async findAll(options: RedditPostsQueryOptions = {}) {
    const conditions = [];

    if (options.since) {
      conditions.push(gte(this.tables.redditPosts.discoveredAt, options.since));
    }
    if (options.subreddit) {
      conditions.push(eq(this.tables.redditPosts.subreddit, options.subreddit));
    }
    if (options.scanName) {
      conditions.push(eq(this.tables.redditPosts.scanName, options.scanName));
    }
    if (options.search) {
      conditions.push(like(this.tables.redditPosts.title, `%${options.search}%`));
    }

    let query = this.db
      .select()
      .from(this.tables.redditPosts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.redditPosts.discoveredAt))
      .$dynamic();

    if (options.limit) {
      query = query.limit(options.limit);
    }

    return query.all();
  }

  async getSubreddits(): Promise<string[]> {
    const rows = this.db
      .selectDistinct({ subreddit: this.tables.redditPosts.subreddit })
      .from(this.tables.redditPosts)
      .orderBy(this.tables.redditPosts.subreddit)
      .all();
    return rows.map((row) => row.subreddit);
  }

  async getScanNames(): Promise<string[]> {
    const rows = this.db
      .selectDistinct({ scanName: this.tables.redditPosts.scanName })
      .from(this.tables.redditPosts)
      .orderBy(this.tables.redditPosts.scanName)
      .all();
    return rows.map((row) => row.scanName);
  }

  async count(): Promise<number> {
    const rows = this.db
      .select({ count: sql<number>`count(*)` })
      .from(this.tables.redditPosts)
      .all();
    return rows[0]?.count ?? 0;
  }

  async countSince(date: Date): Promise<number> {
    const rows = this.db
      .select({ count: sql<number>`count(*)` })
      .from(this.tables.redditPosts)
      .where(gte(this.tables.redditPosts.discoveredAt, date))
      .all();
    return rows[0]?.count ?? 0;
  }
}

export function createRedditPostsRepository(db: AppDbContext): RedditPostsRepository {
  return new RedditPostsRepository(db.connection, db.tablePrefix);
}
