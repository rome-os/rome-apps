import type { Action, ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createCompanyResearchAddJobPostAction } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return createCompanyResearchAddJobPostAction(config, deps);
}
