import type { Action, ActionConfig } from "@rome-os/app-runtime";
import { createNamedAction } from "../../lib/factory.js";
import type { XhsActionDeps } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: XhsActionDeps): Action {
  return createNamedAction("user-profile", config, deps);
}
