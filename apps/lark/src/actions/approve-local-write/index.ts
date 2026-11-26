import {
  defineAction,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { localWriteSchema } from "../input.js";
import { previewLocalWrite } from "../write/index.js";
import { LarkService } from "../../lib/service.js";
import { actionErrorMessage } from "../../lib/policy.js";

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const action = defineAction({
    config,
    schema: localWriteSchema,
    execute: async (input) => {
      try {
        return {
          status: "ok",
          data: await new LarkService(deps.appContext).invoke(input, "write"),
        };
      } catch (error) {
        return { status: "error", error: actionErrorMessage(error) };
      }
    },
  });
  action.preview = (raw) => previewLocalWrite(raw, deps);
  return action;
}
