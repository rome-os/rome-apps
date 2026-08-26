import type { Action, ActionConfig, ActionResult, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { searchReddit, getSubredditPosts } from "./client.js";

export function createRedditAction(config: ActionConfig): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "hot", "new", "top"],
          description: "The action to perform",
        },
        query: {
          type: "string",
          description: "Search query (required for search action)",
        },
        subreddit: {
          type: "string",
          description: "Subreddit name (without r/ prefix)",
        },
        sort: {
          type: "string",
          enum: ["relevance", "hot", "top", "new", "comments"],
          description: "Sort order for search results",
        },
        time: {
          type: "string",
          enum: ["hour", "day", "week", "month", "year", "all"],
          description: "Time filter",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 25)",
        },
      },
      required: ["action"],
    },
    execute: async (input): Promise<ActionResult> => {
      const { action, query, subreddit, sort, time, limit } = input as {
        action: string;
        query?: string;
        subreddit?: string;
        sort?: string;
        time?: string;
        limit?: number;
      };

      if (action === "search") {
        if (!query) {
          return { status: "error", error: "query is required for search action" };
        }
        const posts = await searchReddit(query, { subreddit, sort, time, limit });
        return { status: "ok", data: { posts, count: posts.length } };
      }

      if (action === "hot" || action === "new" || action === "top") {
        if (!subreddit) {
          return { status: "error", error: "subreddit is required for hot/new/top actions" };
        }
        const posts = await getSubredditPosts(action, { subreddit, limit, time });
        return { status: "ok", data: { posts, count: posts.length } };
      }

      return { status: "error", error: `Unknown action: ${action}` };
    },
  };
}

export function createAction(
  config: ActionConfig,
  _deps: AppActionRuntimeDeps<Record<string, never>>,
): Action {
  return createRedditAction(config);
}
