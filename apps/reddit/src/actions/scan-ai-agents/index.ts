import type { Action, ActionConfig, ActionResult, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { runAiAgentScan } from "../../lib/scan-service.js";

interface ScanAiAgentsInput {
  scanName?: string;
  queries?: string[];
  subreddits?: string[];
  sort?: "new" | "relevance" | "comments";
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
  limitPerQuery?: number;
  interRequestDelayMs?: number;
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        scanName: { type: "string", description: "Logical scan profile name" },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Queries to execute against Reddit search",
        },
        subreddits: {
          type: "array",
          items: { type: "string" },
          description: "Subreddits to search without the r/ prefix",
        },
        sort: {
          type: "string",
          enum: ["new", "relevance", "comments"],
          description: "Reddit search ordering",
        },
        time: {
          type: "string",
          enum: ["hour", "day", "week", "month", "year", "all"],
          description: "Reddit time filter",
        },
        limitPerQuery: {
          type: "number",
          description: "How many posts to fetch per query/subreddit pair",
        },
        interRequestDelayMs: {
          type: "number",
          description: "Delay between Reddit requests in milliseconds",
        },
      },
    },
    async execute(input): Promise<ActionResult> {
      const result = await runAiAgentScan(deps.appContext, input as ScanAiAgentsInput);
      if (result.status === "error") {
        throw new Error("AI agent Reddit scan failed");
      }
      return {
        status: "ok",
        data: result,
      };
    },
  };
}
