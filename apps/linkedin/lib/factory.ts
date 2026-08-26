import type { Action, ActionConfig } from "@rome-os/app-runtime";
import { createLinkedinAction, type LinkedinActionDeps } from "./actions.js";

export function createNamedAction(
  actionName: string,
  config: ActionConfig,
  deps: LinkedinActionDeps,
): Action {
  return createLinkedinAction(actionName, config, deps);
}
