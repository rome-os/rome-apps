import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";

const log = createAppLogger("teach_log_learning");

const schema = z.object({
  mission_id: z.string().trim().min(1).describe("Mission the insight belongs to"),
  lesson_id: z.string().trim().optional().describe("Optional lesson the insight relates to"),
  content: z.string().trim().min(1).describe("The insight / note (markdown)"),
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
      if (input.lesson_id) {
        const lesson = repo.getLesson(input.lesson_id);
        if (!lesson) {
          return { status: "error", error: `Lesson not found: ${input.lesson_id}` };
        }
      }
      repo.addLearningRecord({
        missionId: input.mission_id,
        lessonId: input.lesson_id ?? null,
        content: input.content,
      });
      log.info("learning record added", { missionId: input.mission_id });
      return { status: "ok", data: { ok: true } };
    },
  });
}
