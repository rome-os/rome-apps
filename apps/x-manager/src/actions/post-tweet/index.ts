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
        text: {
          type: "string",
          description: "The tweet text content to post",
        },
        images: {
          type: "string",
          description: "Comma-separated image file paths (max 4, jpg/png/gif/webp)",
        },
      },
      required: ["text"],
    },
    async execute(args): Promise<ActionResult> {
      const text = String(args.text);
      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "post-tweet",
          status: "running",
          inputJson: JSON.stringify({ text: text.slice(0, 200) }),
          startedAt: new Date(),
        });
      } catch { /* best effort */ }

      const options: Record<string, string | boolean> = {};
      if (args.images && String(args.images).trim()) {
        options["images"] = String(args.images).trim();
      }

      const result = await runTwitterCli("post", [text], options, 180_000);

      if (!result.success) {
        try { repo?.completeActionRun(runId, "error", null, result.stderr || result.stdout); } catch { /* */ }
        return {
          status: "error",
          error: `Failed to post tweet: ${result.stderr || result.stdout}`,
        };
      }

      try { repo?.completeActionRun(runId, "success", JSON.stringify({ posted: true })); } catch { /* */ }

      return {
        status: "ok",
        data: {
          posted: true,
          text,
          message: "Tweet posted successfully",
          output: result.stdout,
        },
      };
    },
  };
}
