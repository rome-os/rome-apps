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

const log = createAppLogger("teach_assess_level");

const schema = z.object({
  mission_id: z.string().trim().min(1).describe("Mission to update"),
  target_level: z
    .enum(["beginner", "intermediate", "advanced"])
    .describe("Assessed level for calibrating lessons"),
  notes: z
    .string()
    .trim()
    .optional()
    .describe("Assessment notes / learner preferences to remember"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      const mission = repo.getMission(input.mission_id);
      if (!mission) {
        return { status: "error", error: `Mission not found: ${input.mission_id}` };
      }
      const updated = repo.updateMission(input.mission_id, {
        targetLevel: input.target_level,
        // Append assessment notes rather than clobbering existing notes.
        notes: input.notes
          ? mission.notes
            ? `${mission.notes}\n\n${input.notes}`
            : input.notes
          : mission.notes,
      });
      log.info("level assessed", { missionId: input.mission_id, level: input.target_level });
      return { status: "ok", data: { mission: serializeMission(updated!) } };
    },
  });
}
