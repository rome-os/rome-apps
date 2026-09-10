import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { serializeLesson } from "../../lib/wire.js";

const log = createAppLogger("teach_complete_lesson");

const schema = z.object({
  lesson_id: z.string().trim().min(1).describe("Lesson to mark completed"),
  learning_note: z
    .string()
    .trim()
    .optional()
    .describe("Optional note on what was learned; stored as a learning_record"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      const lesson = repo.getLesson(input.lesson_id);
      if (!lesson) {
        return { status: "error", error: `Lesson not found: ${input.lesson_id}` };
      }

      const updated = repo.updateLesson(lesson.id, {
        status: "completed",
        completedAt: new Date(),
      });

      const note = input.learning_note?.trim() || `Completed lesson: ${lesson.title}`;
      repo.addLearningRecord({
        missionId: lesson.missionId,
        lessonId: lesson.id,
        content: note,
      });

      log.info("lesson completed", { lessonId: lesson.id });
      return { status: "ok", data: { lesson: serializeLesson(updated!) } };
    },
  });
}
