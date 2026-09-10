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

const log = createAppLogger("teach_save_lesson");

const schema = z.object({
  lesson_id: z.string().trim().min(1).describe("Draft lesson to fill in"),
  title: z.string().trim().min(1).describe("Lesson title"),
  objective: z.string().trim().min(1).describe("What this lesson teaches"),
  html: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Self-contained interactive HTML lesson body fragment (rendered in a sandboxed iframe runtime: highlighted code, Mermaid diagrams, interactive components; <style>/<script> allowed)",
    ),
  summary: z.string().trim().optional().describe("Short text summary of the lesson"),
  cards: z
    .array(
      z
        .object({
          front: z.string().trim().min(1).describe("Prompt/question"),
          back: z.string().trim().min(1).describe("Answer/explanation (the correct answer)"),
          quiz_type: z
            .enum(["mcq", "qa"])
            .describe(
              "mcq for discrete/factual answers (provide 3 distractors); qa for conceptual/open answers (no options)",
            ),
          options: z
            .array(z.string().trim().min(1))
            .optional()
            .describe(
              "For mcq ONLY: exactly 3 plausible, non-overlapping wrong answers (distractors). Omit for qa.",
            ),
        })
        .superRefine((c, ctx) => {
          if (c.quiz_type === "mcq") {
            const distractors = (c.options ?? []).filter((o) => o.trim().length > 0);
            const unique = new Set(distractors.map((o) => o.trim().toLowerCase()));
            // Reject distractors that collide with each other or the answer.
            unique.delete(c.back.trim().toLowerCase());
            if (distractors.length !== 3 || unique.size !== 3) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  "mcq cards require exactly 3 distinct distractors in `options`, none equal to `back`",
                path: ["options"],
              });
            }
          }
        }),
    )
    .min(1)
    .max(12)
    .describe("Review cards auto-extracted from the lesson (aim for 3-8)"),
  resources: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        url: z.string().trim().optional(),
        note: z.string().trim().optional(),
      }),
    )
    .optional()
    .describe("Cited external sources used for accuracy/currency"),
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

      const updated = repo.updateLesson(input.lesson_id, {
        title: input.title,
        objective: input.objective,
        html: input.html,
        summary: input.summary ?? "",
        status: "published",
        errorNote: null,
      });

      let cardCount = 0;
      for (const c of input.cards) {
        const quizType = c.quiz_type;
        const options =
          quizType === "mcq"
            ? (c.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0)
            : null;
        repo.createCard({
          missionId: lesson.missionId,
          lessonId: lesson.id,
          front: c.front,
          back: c.back,
          quizType,
          options,
        });
        cardCount += 1;
      }

      let resourceCount = 0;
      for (const r of input.resources ?? []) {
        repo.addResource({
          missionId: lesson.missionId,
          title: r.title,
          url: r.url,
          note: r.note,
        });
        resourceCount += 1;
      }

      log.info("lesson saved", { lessonId: lesson.id, cardCount, resourceCount });
      return {
        status: "ok",
        data: { lesson: serializeLesson(updated!), cardCount, resourceCount },
      };
    },
  });
}
