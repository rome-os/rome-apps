import type { Action, ActionConfig, ActionResult, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { ensureAiAgentSchedule } from "../../lib/schedule.js";

interface EnsureAiAgentWatchInput {
  tzid?: string;
  localTime?: string;
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        tzid: {
          type: "string",
          description: "IANA timezone for the recurring schedule",
        },
        localTime: {
          type: "string",
          description: "Minute alignment in HH:mm for the recurring schedule",
        },
      },
    },
    async execute(input): Promise<ActionResult> {
      const result = await ensureAiAgentSchedule(
        deps.appContext,
        input as EnsureAiAgentWatchInput,
      );
      return {
        status: "ok",
        data: result,
      };
    },
  };
}
