import type { ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createViewAction } from "../../lib/agentAction.js";
export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps) {
  return createViewAction("inspect", config, deps);
}
