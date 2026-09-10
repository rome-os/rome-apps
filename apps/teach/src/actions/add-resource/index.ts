import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { serializeResource } from "../../lib/wire.js";

const log = createAppLogger("teach_add_resource");

const schema = z.object({
  title: z.string().trim().min(1).describe("Resource title"),
  url: z.string().trim().optional().describe("Resource URL"),
  note: z.string().trim().optional().describe("Why this resource matters / how it was used"),
  mission_id: z.string().trim().optional().describe("Optional mission this resource belongs to"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      if (input.mission_id) {
        const mission = repo.getMission(input.mission_id);
        if (!mission) {
          return { status: "error", error: `Mission not found: ${input.mission_id}` };
        }
      }
      const resource = repo.addResource({
        missionId: input.mission_id ?? null,
        title: input.title,
        url: input.url,
        note: input.note,
      });
      log.info("resource added", { resourceId: resource.id });
      return { status: "ok", data: { resource: serializeResource(resource) } };
    },
  });
}
