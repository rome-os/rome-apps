import type { Action, ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { createCompanyResearchAddProductAction } from "../../lib/actions.js";

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return createCompanyResearchAddProductAction(config, deps);
}
