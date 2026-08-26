import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { runTwitterCli, parseYamlRecords } from "../../lib/cli.js";
import { createXRepository } from "../../db/repositories/repo.js";

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Twitter username to fetch tweets from. Required.",
        },
        limit: {
          type: "number",
          description: "Maximum number of tweets to fetch (default: 20)",
        },
      },
      required: ["username"],
    },
    async execute(args): Promise<ActionResult> {
      const username = String(args.username).replace(/^@/, "");
      const limit = (args.limit as number) || 20;
      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "fetch-tweets",
          status: "running",
          inputJson: JSON.stringify({ username, limit }),
          startedAt: new Date(),
        });
      } catch { /* best effort */ }

      const result = await runTwitterCli(
        "tweets",
        [username],
        { limit: String(limit) },
      );

      if (!result.success) {
        try { repo?.completeActionRun(runId, "error", null, result.stderr); } catch { /* */ }
        return {
          status: "error",
          error: `Failed to fetch tweets for @${username}: ${result.stderr}`,
        };
      }

      const tweets = parseYamlRecords(result.stdout);

      try { repo?.completeActionRun(runId, "success", JSON.stringify({ count: tweets.length })); } catch { /* */ }

      return {
        status: "ok",
        data: {
          username,
          tweets: tweets.map((t) => ({
            id: t["id"] || "",
            text: t["text"] || "",
            author: t["author"] || username,
            createdAt: t["created_at"] || "",
            likes: t["likes"] || "0",
            retweets: t["retweets"] || "0",
            replies: t["replies"] || "0",
            views: t["views"] || "0",
            url: t["url"] || "",
            isRetweet: t["is_retweet"] === "true",
            hasMedia: t["has_media"] === "true",
          })),
          count: tweets.length,
        },
      };
    },
  };
}
