import { commandDetails } from "../../lib/command-details.js";
import {
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
export function createAction(
  config: ActionConfig,
  _deps: AppActionRuntimeDeps,
): Action {
  return defineAction({
    config,
    schema: z.object({ command: z.string().max(80) }),
    execute: async ({ command }) => {
      try {
        return { status: "ok", data: commandDetails(command) };
      } catch {
        return { status: "error", error: "command_not_allowed" };
      }
    },
  });
}
