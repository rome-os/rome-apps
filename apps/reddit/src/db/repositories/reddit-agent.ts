import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createRedditDbSchema } from "../schema.js";

export interface RedditAgentScanRunStart {
  scanName: string;
  queryCount: number;
  subredditCount: number;
}

export interface RedditAgentScanRunFinish {
  runId: string;
  status: "success" | "partial" | "error";
  scannedPairCount: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  errors: string[];
}

export interface RedditAgentPostRecordInput {
  redditPostId: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  url?: string;
  selftext?: string;
  searchQuery: string;
  scanName: string;
  createdUtc: Date;
}

export interface RedditAgentPostFilters {
  since?: Date;
  subreddit?: string;
  search?: string;
  scanName?: string;
  limit?: number;
}

export interface RedditAgentUpsertSummary {
  insertedCount: number;
  updatedCount: number;
  total: number;
}

export class RedditAgentRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createRedditDbSchema(tablePrefix);
  }

  async startRun(input: RedditAgentScanRunStart): Promise<string> {
    const runId = uuid();
    await this.db.insert(this.tables.redditAgentScanRuns).values({
      id: runId,
      scanName: input.scanName,
      status: "running",
      queryCount: input.queryCount,
      subredditCount: input.subredditCount,
      scannedPairCount: 0,
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      errorCount: 0,
      errors: [],
      startedAt: new Date(),
      finishedAt: null,
    });
    return runId;
  }

  async finishRun(input: RedditAgentScanRunFinish): Promise<void> {
    await this.db
      .update(this.tables.redditAgentScanRuns)
      .set({
        status: input.status,
        scannedPairCount: input.scannedPairCount,
        fetchedCount: input.fetchedCount,
        insertedCount: input.insertedCount,
        updatedCount: input.updatedCount,
        errorCount: input.errors.length,
        errors: input.errors,
        finishedAt: new Date(),
      })
      .where(eq(this.tables.redditAgentScanRuns.id, input.runId));
  }

  async bulkUpsertPosts(
    runId: string,
    posts: RedditAgentPostRecordInput[],
  ): Promise<RedditAgentUpsertSummary> {
    if (posts.length === 0) {
      return {
        insertedCount: 0,
        updatedCount: 0,
        total: 0,
      };
    }

    const postIds = Array.from(new Set(posts.map((post) => post.redditPostId)));
    const existingRows = this.db
      .select({ redditPostId: this.tables.redditAgentPosts.redditPostId })
      .from(this.tables.redditAgentPosts)
      .where(inArray(this.tables.redditAgentPosts.redditPostId, postIds))
      .all();
    const existingIds = new Set(existingRows.map((row) => row.redditPostId));
    const now = new Date();

    this.db.transaction((tx) => {
      for (const post of posts) {
        tx.insert(this.tables.redditAgentPosts)
          .values({
            id: uuid(),
            redditPostId: post.redditPostId,
            title: post.title,
            subreddit: post.subreddit,
            author: post.author,
            score: post.score,
            numComments: post.numComments,
            permalink: post.permalink,
            url: post.url ?? null,
            selftext: post.selftext ?? null,
            searchQuery: post.searchQuery,
            scanName: post.scanName,
            createdUtc: post.createdUtc,
            firstSeenAt: now,
            lastSeenAt: now,
            seenCount: 1,
            firstScanRunId: runId,
            lastScanRunId: runId,
          })
          .onConflictDoUpdate({
            target: this.tables.redditAgentPosts.redditPostId,
            set: {
              title: sql`excluded.title`,
              subreddit: sql`excluded.subreddit`,
              author: sql`excluded.author`,
              score: sql`excluded.score`,
              numComments: sql`excluded.num_comments`,
              permalink: sql`excluded.permalink`,
              url: sql`excluded.url`,
              selftext: sql`excluded.selftext`,
              searchQuery: sql`excluded.search_query`,
              scanName: sql`excluded.scan_name`,
              createdUtc: sql`excluded.created_utc`,
              lastSeenAt: now,
              seenCount: sql`${this.tables.redditAgentPosts.seenCount} + 1`,
              lastScanRunId: runId,
            },
          })
          .run();
      }
    });

    const insertedCount = posts.filter((post) => !existingIds.has(post.redditPostId)).length;
    return {
      insertedCount,
      updatedCount: posts.length - insertedCount,
      total: posts.length,
    };
  }

  async listPosts(filters: RedditAgentPostFilters = {}) {
    const conditions = [];

    if (filters.since) {
      conditions.push(gte(this.tables.redditAgentPosts.lastSeenAt, filters.since));
    }
    if (filters.subreddit) {
      conditions.push(eq(this.tables.redditAgentPosts.subreddit, filters.subreddit));
    }
    if (filters.scanName) {
      conditions.push(eq(this.tables.redditAgentPosts.scanName, filters.scanName));
    }
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(
        or(
          like(this.tables.redditAgentPosts.title, pattern),
          like(this.tables.redditAgentPosts.selftext, pattern),
        ),
      );
    }

    let query = this.db
      .select()
      .from(this.tables.redditAgentPosts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.redditAgentPosts.lastSeenAt), desc(this.tables.redditAgentPosts.score))
      .$dynamic();

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    return query.all();
  }

  async listRuns(limit: number = 12) {
    return this.db
      .select()
      .from(this.tables.redditAgentScanRuns)
      .orderBy(desc(this.tables.redditAgentScanRuns.startedAt))
      .limit(limit)
      .all();
  }

  async countPosts(): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(this.tables.redditAgentPosts)
      .all()[0];
    return row?.count ?? 0;
  }

  async countPostsSince(since: Date): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(this.tables.redditAgentPosts)
      .where(gte(this.tables.redditAgentPosts.lastSeenAt, since))
      .all()[0];
    return row?.count ?? 0;
  }

  async listSubreddits(): Promise<string[]> {
    return this.db
      .selectDistinct({ subreddit: this.tables.redditAgentPosts.subreddit })
      .from(this.tables.redditAgentPosts)
      .orderBy(this.tables.redditAgentPosts.subreddit)
      .all()
      .map((row) => row.subreddit);
  }

  async listQueries(): Promise<string[]> {
    return this.db
      .selectDistinct({ searchQuery: this.tables.redditAgentPosts.searchQuery })
      .from(this.tables.redditAgentPosts)
      .orderBy(this.tables.redditAgentPosts.searchQuery)
      .all()
      .map((row) => row.searchQuery);
  }

  async topSubreddits(since: Date | undefined, limit: number = 6) {
    return this.db
      .select({
        subreddit: this.tables.redditAgentPosts.subreddit,
        count: sql<number>`count(*)`,
      })
      .from(this.tables.redditAgentPosts)
      .where(since ? gte(this.tables.redditAgentPosts.lastSeenAt, since) : undefined)
      .groupBy(this.tables.redditAgentPosts.subreddit)
      .orderBy(sql`count(*) desc`, this.tables.redditAgentPosts.subreddit)
      .limit(limit)
      .all();
  }

  async latestRun() {
    const rows = await this.listRuns(1);
    return rows[0] ?? null;
  }
}

export function createRedditAgentRepository(db: AppDbContext): RedditAgentRepository {
  return new RedditAgentRepository(db.connection, db.tablePrefix);
}
