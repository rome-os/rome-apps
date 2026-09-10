import {
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { buildDashboardData } from "../../lib/queries.js";

const schema = z.object({});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async () => {
      const repo = createTeachRepository(deps.appContext.db);
      const data = await buildDashboardData(repo, () => deps.appContext.listRoutines());
      return { status: "ok", data };
    },
  });
}
