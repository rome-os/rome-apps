import {
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { buildResourcesData } from "../../lib/queries.js";

const schema = z.object({
  mission_id: z.string().trim().optional().describe("Optional mission filter"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      if (input.mission_id && !repo.getMission(input.mission_id)) {
        return { status: "error", error: `Mission not found: ${input.mission_id}` };
      }
      return { status: "ok", data: buildResourcesData(repo, input.mission_id ?? null) };
    },
  });
}
