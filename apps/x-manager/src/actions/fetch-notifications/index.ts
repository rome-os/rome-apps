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
        limit: {
          type: "number",
          description: "Maximum number of notifications to fetch (default: 20)",
        },
      },
    },
    async execute(args): Promise<ActionResult> {
      const limit = (args.limit as number) || 20;
      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "fetch-notifications",
          status: "running",
          inputJson: JSON.stringify({ limit }),
          startedAt: new Date(),
        });
      } catch { /* best effort */ }

      const result = await runTwitterCli(
        "notifications",
        [],
        { limit: String(limit) },
      );

      if (!result.success) {
        try { repo?.completeActionRun(runId, "error", null, result.stderr); } catch { /* */ }
        return {
          status: "error",
          error: `Failed to fetch notifications: ${result.stderr}`,
        };
      }

      const notifications = parseYamlRecords(result.stdout);

      try { repo?.completeActionRun(runId, "success", JSON.stringify({ count: notifications.length })); } catch { /* */ }

      return {
        status: "ok",
        data: {
          notifications: notifications.map((n) => ({
            id: n["id"] || "",
            action: n["action"] || "",
            author: n["author"] || "",
            text: n["text"] || "",
            url: n["url"] || "",
          })),
          count: notifications.length,
        },
      };
    },
  };
}
