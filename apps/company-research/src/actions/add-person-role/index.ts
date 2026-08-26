import type { Action, ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createCompanyResearchAddPersonRoleAction } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return createCompanyResearchAddPersonRoleAction(config, deps);
}
