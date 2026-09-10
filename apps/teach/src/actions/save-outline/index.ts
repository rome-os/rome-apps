import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";

const log = createAppLogger("teach_save_outline");

const schema = z.object({
  mission_id: z.string().trim().min(1).describe("Mission to attach the syllabus to"),
  regen: z
    .boolean()
    .optional()
    .describe(
      "When true, clear incomplete (still-planned) lessons and re-plan; started/completed lessons are preserved",
    ),
  modules: z
    .array(
      z.object({
        title: z.string().trim().min(1).describe("Module / chapter title"),
        objective: z
          .string()
          .trim()
          .optional()
          .describe("One sentence on what this module covers"),
        lessons: z
          .array(
            z.object({
              title: z.string().trim().min(1).describe("Planned lesson title"),
              objective: z
                .string()
                .trim()
                .optional()
                .describe("One sentence on what this lesson teaches"),
            }),
          )
          .min(1)
          .max(8)
          .describe("Ordered planned lessons in this module (2-5 is ideal)"),
      }),
    )
    .min(1)
    .max(8)
    .describe("Ordered modules forming the syllabus (2-6 is ideal)"),
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

      const { moduleCount, lessonCount } = repo.saveOutline(mission.id, input.modules, {
        regen: input.regen,
      });

      log.info("outline saved", { missionId: mission.id, moduleCount, lessonCount });
      return { status: "ok", data: { moduleCount, lessonCount } };
    },
  });
}
