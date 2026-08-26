import type { Action, ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createCompanyResearchAddNotableEventAction } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return createCompanyResearchAddNotableEventAction(config, deps);
}
