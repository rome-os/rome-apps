import type { Action, ActionConfig } from "@rome-os/app-runtime";
import { createNamedAction } from "../../lib/factory.js";
import type { LinkedinActionDeps } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: LinkedinActionDeps): Action {
  return createNamedAction("get-sidebar-profiles", config, deps);
}
