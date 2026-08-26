import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { runTwitterCli } from "../../lib/cli.js";
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
        url: {
          type: "string",
          description: "The URL of the tweet to reply to",
        },
        text: {
          type: "string",
          description: "The reply text content",
        },
        image: {
          type: "string",
          description: "Optional local image path to attach to the reply",
        },
        imageUrl: {
          type: "string",
          description: "Optional remote image URL to download and attach",
        },
      },
      required: ["url", "text"],
    },
    async execute(args): Promise<ActionResult> {
      const url = String(args.url);
      const text = String(args.text);
      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "reply-tweet",
          status: "running",
          inputJson: JSON.stringify({ url, text: text.slice(0, 200) }),
          startedAt: new Date(),
        });
      } catch { /* best effort */ }

      const options: Record<string, string | boolean> = {};
      if (args.image && String(args.image).trim()) {
        options["image"] = String(args.image).trim();
      }
      if (args.imageUrl && String(args.imageUrl).trim()) {
        options["image-url"] = String(args.imageUrl).trim();
      }

      const result = await runTwitterCli("reply", [url, text], options, 180_000);

      if (!result.success) {
        try { repo?.completeActionRun(runId, "error", null, result.stderr || result.stdout); } catch { /* */ }
        return {
          status: "error",
          error: `Failed to reply to tweet: ${result.stderr || result.stdout}`,
        };
      }

      try { repo?.completeActionRun(runId, "success", JSON.stringify({ replied: true, tweetUrl: url })); } catch { /* */ }

      return {
        status: "ok",
        data: {
          replied: true,
          tweetUrl: url,
          replyText: text,
          message: "Reply posted successfully",
          output: result.stdout,
        },
      };
    },
  };
}
