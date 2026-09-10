import {
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { buildDueReviewsData } from "../../lib/queries.js";

const schema = z.object({
  mission_id: z
    .string()
    .trim()
    .optional()
    .describe("Optional: restrict to one mission (e.g. the review screen for a single mission)"),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Optional cap on total cards returned"),
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

      return {
        status: "ok",
        data: buildDueReviewsData(repo, {
          missionId: input.mission_id,
          limit: input.limit,
        }),
      };
    },
  });
}
