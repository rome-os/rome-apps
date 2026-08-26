import { createAppLogger } from "@rome-os/app-runtime";
import type { Action, ActionConfig, ActionResult, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createRedditPostsRepository, type RedditPostsRepository } from "../../db/repositories/reddit-posts.js";
import type { RedditScanInput } from "./types.js";
export type { RedditScanInput, RedditScanOutput } from "./types.js";
import { searchReddit } from "../reddit/client.js";

const log = createAppLogger("reddit_scan");

type RedditScanConfig = Required<RedditScanInput>;

const DEFAULT_CONFIG: RedditScanConfig = {
  scanName: "ai_infra",
  queries: [
    '"AI infrastructure" OR "AI infra"',
    '"AI agents" OR "AI agent" OR "agentic AI"',
    '"AI orchestration" OR "LLM orchestration" OR "agent orchestration"',
    '"AI automation" OR "LLM automation"',
    '"LLM deployment" OR "LLM inference" OR "model serving"',
    '"LLM pricing" OR "AI pricing" OR "inference cost"',
  ],
  subreddits: [
    "MachineLearning",
    "artificial",
    "LocalLLaMA",
    "singularity",
    "devops",
    "programming",
    "technology",
  ],
  excludePatterns: ["review"],
  time: "day",
  limitPerQuery: 25,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRedditScanAction(
  config: ActionConfig,
  deps: { redditPostsRepo: RedditPostsRepository },
): Action {
  return {
    config,
    // No inputSchema — not agent-callable
    async execute(args: Record<string, unknown>): Promise<ActionResult> {
      const scanConfig: RedditScanConfig = (args as unknown as RedditScanConfig).scanName
        ? (args as unknown as RedditScanConfig)
        : DEFAULT_CONFIG;

      const scanName = scanConfig.scanName;
      const time = scanConfig.time ?? "day";
      const limitPerQuery = scanConfig.limitPerQuery ?? 25;
      const excludePatterns = (scanConfig.excludePatterns ?? []).map((p) => p.toLowerCase());

      log.info("Starting Reddit scan", {
        scanName,
        queries: scanConfig.queries.length,
        subreddits: scanConfig.subreddits.length,
      });

      let totalScanned = 0;
      let totalNew = 0;
      const errors: string[] = [];

      for (const query of scanConfig.queries) {
        for (const subreddit of scanConfig.subreddits) {
          try {
            const posts = await searchReddit(query, {
              subreddit,
              sort: "new",
              time,
              limit: limitPerQuery,
            });

            const filtered = posts.filter((post) => {
              const titleLower = post.title.toLowerCase();
              return !excludePatterns.some((pattern) => titleLower.includes(pattern));
            });

            totalScanned += filtered.length;

            const newCount = await deps.redditPostsRepo.bulkUpsert(
              filtered.map((post) => ({
                redditPostId: post.id,
                title: post.title,
                subreddit: post.subreddit,
                author: post.author,
                score: post.score,
                numComments: post.numComments,
                permalink: post.permalink,
                selftext: post.selftext || undefined,
                searchQuery: query,
                scanName,
                createdUtc: new Date(post.createdUtc * 1000),
              })),
            );

            totalNew += newCount;

            await delay(1500);
          } catch (err) {
            const msg = `Error scanning r/${subreddit} for "${query}": ${err instanceof Error ? err.message : String(err)}`;
            log.warn(msg);
            errors.push(msg);
            await delay(1500);
          }
        }
      }

      log.info("Reddit scan complete", { scanName, totalScanned, totalNew, errors: errors.length });

      return {
        status: "ok",
        data: { scanName, totalScanned, totalNew, errors },
      };
    },
  };
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return createRedditScanAction(config, {
    redditPostsRepo: createRedditPostsRepository(deps.appContext.db),
  });
}
