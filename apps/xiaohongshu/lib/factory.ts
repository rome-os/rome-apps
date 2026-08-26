import type { Action, ActionConfig } from "@rome-os/app-runtime";
import { createXiaohongshuAction, type XhsActionDeps } from "./actions.js";

export function createNamedAction(
  actionName: string,
  config: ActionConfig,
  deps: XhsActionDeps,
): Action {
  return createXiaohongshuAction(actionName, config, deps);
}
