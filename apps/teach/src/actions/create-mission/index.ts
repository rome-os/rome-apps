import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { serializeMission } from "../../lib/wire.js";

const log = createAppLogger("teach_create_mission");

const schema = z.object({
  title: z.string().trim().min(1).describe("What the guardian is learning, e.g. 'Rust ownership'"),
  motivation: z
    .string()
    .trim()
    .optional()
    .describe("The underlying why — the deeper goal driving this mission"),
  target_level: z
    .enum(["beginner", "intermediate", "advanced"])
    .optional()
    .describe("Calibration level; defaults to beginner"),
  notes: z.string().trim().optional().describe("Preferences / constraints for lessons"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      const mission = repo.createMission({
        title: input.title,
        motivation: input.motivation,
        targetLevel: input.target_level,
        notes: input.notes,
      });
      log.info("mission created", { missionId: mission.id, title: mission.title });
      return { status: "ok", data: { mission: serializeMission(mission) } };
    },
  });
}
