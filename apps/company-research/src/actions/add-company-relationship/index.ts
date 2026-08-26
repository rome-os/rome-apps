import type { Action, ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createCompanyResearchAddCompanyRelationshipAction } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return createCompanyResearchAddCompanyRelationshipAction(config, deps);
}
