import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { serializeLesson, serializeModule } from "../../lib/wire.js";

const log = createAppLogger("teach_generate_outline");

const schema = z.object({
  mission_id: z.string().trim().min(1).describe("Mission to design a syllabus for"),
  regen: z
    .boolean()
    .optional()
    .describe("Re-plan an existing mission: clears incomplete planned lessons, keeps started ones"),
});

function buildPrompt(args: {
  missionId: string;
  missionTitle: string;
  motivation: string;
  targetLevel: string;
  notes: string;
  regen: boolean;
  keptTitles: string[];
}): string {
  const lines = [
    `Design the learning syllabus for a mission.`,
    "",
    `Mission: ${args.missionTitle}`,
    `Learner's motivation (why they're learning this): ${args.motivation || "(not stated)"}`,
    `Target level: ${args.targetLevel}`,
    `Learner notes / preferences: ${args.notes || "(none)"}`,
    "",
    args.regen
      ? args.keptTitles.length
        ? `This is a RE-PLAN. The learner has already started/completed these lessons — do NOT repeat them; plan what comes AFTER: ${args.keptTitles.join("; ")}`
        : "This is a RE-PLAN of the whole syllabus."
      : "This is the FIRST plan for this mission.",
    "",
    "Break the mission into a coherent, progressive curriculum:",
    "  - 2 to 6 MODULES (chapters), ordered from foundational to advanced.",
    "  - Each module has 2 to 5 PLANNED LESSONS, ordered.",
    "  - Scale the size to the topic's real complexity — a narrow topic may need",
    "    only 2 small modules; a broad one can use more. Do not pad.",
    "  - Each module and lesson gets a concise title and a one-sentence objective.",
    "  - Calibrate scope to the learner's target level and motivation; sequence so",
    "    each lesson builds on the previous ones (zone of proximal development).",
    "",
    "Lessons here are PLANS ONLY — titles and objectives, no body content (that is",
    "authored later, one lesson at a time).",
    "",
    `When the plan is ready, call the \`teach_save_outline\` action exactly once with:`,
    `  - mission_id: "${args.missionId}"`,
    args.regen ? "  - regen: true" : null,
    "  - modules: the ordered modules, each { title, objective, lessons: [{ title, objective }] }",
    "",
    "After teach_save_outline succeeds, reply with a one-line confirmation naming the modules.",
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

      const regen = input.regen ?? false;
      const keptTitles = repo
        .listLessonsByMission(mission.id)
        .filter((l) => l.status !== "planned")
        .map((l) => l.title);

      const prompt = buildPrompt({
        missionId: mission.id,
        missionTitle: mission.title,
        motivation: mission.motivation,
        targetLevel: mission.targetLevel,
        notes: mission.notes,
        regen,
        keptTitles,
      });

      try {
        const summon = await deps.appContext.runAction("summon", {
          agentName: "syllabus-planner",
          prompt,
        });
        if (summon.status !== "ok") {
          const reason = summon.status === "error" ? summon.error : `summon returned ${summon.status}`;
          log.warn("syllabus-planner summon failed", { missionId: mission.id, reason });
          return { status: "ok", data: { planned: false, error: reason, modules: [], lessons: [] } };
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error("outline generation threw", { missionId: mission.id, error: reason });
        return { status: "ok", data: { planned: false, error: reason, modules: [], lessons: [] } };
      }

      const modules = repo.listModulesByMission(mission.id).map(serializeModule);
      const lessons = repo.listLessonsByMission(mission.id).map(serializeLesson);
      const plannedCount = lessons.filter((l) => l.status === "planned").length;
      if (modules.length === 0 || plannedCount === 0) {
        log.warn("planner finished without a usable outline", { missionId: mission.id });
        return {
          status: "ok",
          data: {
            planned: false,
            error: "Syllabus-planner finished without saving a usable outline.",
            modules,
            lessons,
          },
        };
      }

      log.info("outline generated", {
        missionId: mission.id,
        moduleCount: modules.length,
        plannedCount,
      });
      return { status: "ok", data: { planned: true, modules, lessons } };
    },
  });
}
