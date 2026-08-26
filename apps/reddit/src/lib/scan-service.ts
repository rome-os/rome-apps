import type { RomeAppContext } from "@rome-os/app-runtime";
import { searchRedditPosts, type RedditSearchPost } from "./reddit-client.js";
import { createRedditAgentRepository } from "../db/repositories/reddit-agent.js";
import {
  resolveAiAgentScanConfig,
  type AiAgentScanConfig,
} from "./scan-config.js";

export interface AiAgentScanResult {
  runId: string;
  scanName: string;
  status: "success" | "partial" | "error";
  queryCount: number;
  subredditCount: number;
  scannedPairCount: number;
  fetchedCount: number;
  uniquePostCount: number;
  insertedCount: number;
  updatedCount: number;
  errors: string[];
  posts: Array<RedditSearchPost & { searchQuery: string }>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAiAgentScan(
  ctx: Pick<RomeAppContext, "db" | "log">,
  overrides: Partial<AiAgentScanConfig> = {},
): Promise<AiAgentScanResult> {
  const config = resolveAiAgentScanConfig(overrides);
  const repo = createRedditAgentRepository(ctx.db);
  const runId = await repo.startRun({
    scanName: config.scanName,
    queryCount: config.queries.length,
    subredditCount: config.subreddits.length,
  });

  const dedupedPosts = new Map<string, RedditSearchPost & { searchQuery: string }>();
  const errors: string[] = [];
  let fetchedCount = 0;
  let scannedPairCount = 0;

  ctx.log.info("starting AI agent Reddit scan", {
    runId,
    scanName: config.scanName,
    queries: config.queries.length,
    subreddits: config.subreddits.length,
  });

  for (const query of config.queries) {
    for (const subreddit of config.subreddits) {
      scannedPairCount += 1;

      try {
        const posts = await searchRedditPosts({
          query,
          subreddit,
          sort: config.sort,
          time: config.time,
          limit: config.limitPerQuery,
        });

        fetchedCount += posts.length;

        for (const post of posts) {
          const existing = dedupedPosts.get(post.id);
          if (!existing || post.score > existing.score) {
            dedupedPosts.set(post.id, { ...post, searchQuery: query });
          }
        }
      } catch (error) {
        const message = `r/${subreddit} :: ${query} :: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(message);
        ctx.log.warn("AI agent Reddit scan request failed", { runId, subreddit, query, message });
      }

      await delay(config.interRequestDelayMs);
    }
  }

  const upsertSummary = await repo.bulkUpsertPosts(
    runId,
    Array.from(dedupedPosts.values()).map((post) => ({
      redditPostId: post.id,
      title: post.title,
      subreddit: post.subreddit,
      author: post.author || "[deleted]",
      score: post.score,
      numComments: post.numComments,
      permalink: post.permalink,
      url: post.url,
      selftext: post.selftext,
      searchQuery: post.searchQuery,
      scanName: config.scanName,
      createdUtc: new Date(post.createdUtc * 1_000),
    })),
  );

  const status: AiAgentScanResult["status"] =
    errors.length === 0
      ? "success"
      : dedupedPosts.size > 0
      ? "partial"
      : "error";

  await repo.finishRun({
    runId,
    status,
    scannedPairCount,
    fetchedCount,
    insertedCount: upsertSummary.insertedCount,
    updatedCount: upsertSummary.updatedCount,
    errors,
  });

  ctx.log.info("completed AI agent Reddit scan", {
    runId,
    scanName: config.scanName,
    status,
    fetchedCount,
    uniquePostCount: dedupedPosts.size,
    insertedCount: upsertSummary.insertedCount,
    updatedCount: upsertSummary.updatedCount,
    errorCount: errors.length,
  });

  return {
    runId,
    scanName: config.scanName,
    status,
    queryCount: config.queries.length,
    subredditCount: config.subreddits.length,
    scannedPairCount,
    fetchedCount,
    uniquePostCount: dedupedPosts.size,
    insertedCount: upsertSummary.insertedCount,
    updatedCount: upsertSummary.updatedCount,
    errors,
    posts: Array.from(dedupedPosts.values()),
  };
}
