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

const log = createAppLogger("teach_generate_lesson");

const schema = z.object({
  mission_id: z.string().trim().min(1).describe("Mission to generate the next lesson for"),
  lesson_id: z
    .string()
    .trim()
    .optional()
    .describe("Realize a specific PLANNED lesson from the syllabus (JIT). Omit to create a new lesson."),
  topic: z
    .string()
    .trim()
    .optional()
    .describe("Optional specific topic/title for this lesson; otherwise the tutor picks the next step"),
});

function buildPrompt(args: {
  lessonId: string;
  seq: number;
  missionTitle: string;
  motivation: string;
  targetLevel: string;
  notes: string;
  topic?: string;
  plannedTitle?: string;
  plannedObjective?: string;
  moduleTitle?: string;
  moduleObjective?: string;
  prevTitle?: string;
  nextTitle?: string;
  priorTitles: string[];
}): string {
  const plannedLine = args.plannedTitle
    ? `This lesson is a planned syllabus entry: "${args.plannedTitle}"${args.plannedObjective ? ` — objective: ${args.plannedObjective}` : ""}. Author exactly this lesson.`
    : args.topic
      ? `Requested topic for this lesson: ${args.topic}`
      : "No specific topic requested — choose the next logical step.";
  const lines = [
    `You are authoring lesson #${args.seq} for a learning mission.`,
    "",
    `Mission: ${args.missionTitle}`,
    `Learner's motivation (why they're learning this): ${args.motivation || "(not stated)"}`,
    `Target level: ${args.targetLevel}`,
    `Learner notes / preferences: ${args.notes || "(none)"}`,
    args.moduleTitle
      ? `Current module: "${args.moduleTitle}"${args.moduleObjective ? ` — ${args.moduleObjective}` : ""}`
      : null,
    plannedLine,
    args.prevTitle ? `Previous lesson (already covered, build on it): ${args.prevTitle}` : null,
    args.nextTitle ? `Next planned lesson (do NOT cover it yet, leave room): ${args.nextTitle}` : null,
    args.priorTitles.length
      ? `Already-covered lessons (do not repeat): ${args.priorTitles.join("; ")}`
      : "This is the first lesson in the mission.",
    "",
    "Write ONE bite-sized, self-contained lesson calibrated to the learner's zone of proximal development (just beyond what they already know).",
    "",
    "Sourcing (hybrid): rely on your own knowledge by default. For topics that are current, fast-moving, version-specific, or accuracy-critical, use WebSearch/WebFetch to verify, and cite each source you used as a resource.",
    "",
    "When the lesson is ready, call the `teach_save_lesson` action exactly once with:",
    `  - lesson_id: "${args.lessonId}"`,
    "  - title: a concise lesson title",
    "  - objective: one sentence on what this lesson teaches",
    "  - html: a SELF-CONTAINED INTERACTIVE HTML body fragment, rendered inside a sandboxed iframe with its own runtime. Use semantic tags (<h2>, <p>, <ul>, <strong>). Tag code for highlighting: <pre><code class=\"language-ts\">…</code></pre> (use the real language: ts, tsx, js, json, bash, html, css, python, sql, yaml, diff, markdown). Add a Mermaid diagram where one clarifies (<pre class=\"mermaid\">…</pre>). Use the interactive components (teach-quiz, teach-flip, teach-collapse, teach-callout, teach-tabs, teach-stepper, teach-annotated) with their exact markup. You MAY include <style> and one-off <script> for custom interactions. Do NOT include <html>, <head>, or <body> — emit only the inner fragment. Keep it readable and focused.",
    "  - summary: a short plain-text summary",
    "  - cards: 3 to 8 review cards. Each card is { front, back, quiz_type, options? }:",
    "      - front: a question/prompt; back: the correct answer/explanation. Make cards atomic and testable.",
    "      - quiz_type: decide per card from the answer's nature:",
    "          * 'mcq' for DISCRETE / FACTUAL answers (a specific term, value, name, complexity, yes/no, a short canonical phrase). Provide `options`: EXACTLY 3 plausible, distinct distractors — wrong but believable answers a learner might confuse with the correct one. Distractors must NOT overlap each other or equal `back`. The correct answer stays in `back` (do NOT put it in options).",
    "          * 'qa' for CONCEPTUAL / OPEN answers (explain why, describe, compare, reason). Omit `options`.",
    "      - Aim for a MIX: include at least one mcq and at least one qa card when the material supports both.",
    "  - resources: any web sources you cited as { title, url, note } (omit if you used none).",
    "",
    "After teach_save_lesson succeeds, reply with a one-line confirmation including the lesson title. If web research fails, still produce the best model-only lesson and save it.",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

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

      const allLessons = repo.listLessonsByMission(mission.id);

      // JIT path: realize a specific planned lesson from the syllabus. Otherwise
      // create a brand-new draft at the end (legacy "generate next" behavior).
      let draft;
      let plannedTitle: string | undefined;
      let plannedObjective: string | undefined;
      let moduleTitle: string | undefined;
      let moduleObjective: string | undefined;
      let prevTitle: string | undefined;
      let nextTitle: string | undefined;

      if (input.lesson_id) {
        const target = repo.getLesson(input.lesson_id);
        if (!target || target.missionId !== mission.id) {
          return { status: "error", error: `Lesson not found in mission: ${input.lesson_id}` };
        }
        if (target.status === "published" || target.status === "completed") {
          // Already realized — nothing to do; return as-is.
          const cards = repo.listCardsByMission(mission.id).filter((c) => c.lessonId === target.id);
          return {
            status: "ok",
            data: { lesson: serializeLesson(target), generated: true, cardCount: cards.length },
          };
        }
        plannedTitle = target.title;
        plannedObjective = target.objective || undefined;
        // Surrounding context for coherence.
        if (target.moduleId) {
          const mod = repo.listModulesByMission(mission.id).find((m) => m.id === target.moduleId);
          moduleTitle = mod?.title;
          moduleObjective = mod?.objective || undefined;
        }
        const ordered = allLessons;
        const idx = ordered.findIndex((l) => l.id === target.id);
        prevTitle = idx > 0 ? ordered[idx - 1]?.title : undefined;
        nextTitle = idx >= 0 && idx + 1 < ordered.length ? ordered[idx + 1]?.title : undefined;
        // Move planned → draft while it is being authored.
        draft = repo.updateLesson(target.id, { status: "draft", errorNote: null })!;
      } else {
        const seq = repo.nextLessonSeq(mission.id);
        draft = repo.createLesson({
          missionId: mission.id,
          seq,
          title: input.topic ?? `Lesson ${seq}`,
          status: "draft",
        });
      }

      const seq = draft.seq;
      // "Already covered" = everything that isn't this draft and isn't a future plan.
      const priorTitles = allLessons
        .filter((l) => l.id !== draft.id && l.status !== "planned")
        .map((l) => l.title);

      const prompt = buildPrompt({
        lessonId: draft.id,
        seq,
        missionTitle: mission.title,
        motivation: mission.motivation,
        targetLevel: mission.targetLevel,
        notes: mission.notes,
        topic: input.topic,
        plannedTitle,
        plannedObjective,
        moduleTitle,
        moduleObjective,
        prevTitle,
        nextTitle,
        priorTitles,
      });

      try {
        const summon = await deps.appContext.runAction("summon", {
          agentName: "lesson-author",
          prompt,
        });
        if (summon.status !== "ok") {
          const reason = summon.status === "error" ? summon.error : `summon returned ${summon.status}`;
          repo.updateLesson(draft.id, {
            status: "draft",
            errorNote: `Lesson generation failed: ${reason}`,
          });
          log.warn("lesson-author summon failed", { lessonId: draft.id, reason });
          return {
            status: "ok",
            data: {
              lesson: serializeLesson(repo.getLesson(draft.id)!),
              generated: false,
              error: reason,
            },
          };
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        repo.updateLesson(draft.id, {
          status: "draft",
          errorNote: `Lesson generation error: ${reason}`,
        });
        log.error("lesson generation threw", { lessonId: draft.id, error: reason });
        return {
          status: "ok",
          data: { lesson: serializeLesson(repo.getLesson(draft.id)!), generated: false, error: reason },
        };
      }

      // The agent persists via teach_save_lesson; re-read to see the outcome.
      const after = repo.getLesson(draft.id)!;
      const cards = repo.listCardsByMission(mission.id).filter((c) => c.lessonId === draft.id);
      if (after.status !== "published" || cards.length === 0) {
        const note =
          after.errorNote ?? "Lesson-author finished without saving a complete lesson.";
        repo.updateLesson(draft.id, { status: "draft", errorNote: note });
        log.warn("lesson left as draft", { lessonId: draft.id });
        return {
          status: "ok",
          data: { lesson: serializeLesson(repo.getLesson(draft.id)!), generated: false, error: note },
        };
      }

      log.info("lesson generated", { lessonId: draft.id, cardCount: cards.length });
      return {
        status: "ok",
        data: { lesson: serializeLesson(after), generated: true, cardCount: cards.length },
      };
    },
  });
}
