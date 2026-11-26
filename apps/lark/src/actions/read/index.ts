import {
  defineAction,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { invocationSchema } from "../input.js";
import { LarkService } from "../../lib/service.js";
import { actionErrorMessage } from "../../lib/policy.js";
export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return defineAction({
    config,
    schema: invocationSchema,
    execute: async (input) => {
      try {
        return {
          status: "ok",
          data: await new LarkService(deps.appContext).invoke(input, "read"),
        };
      } catch (e) {
        return { status: "error", error: actionErrorMessage(e) };
      }
    },
  });
}
