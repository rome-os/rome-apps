import {
  type RomeAppApiHandler,
  type RomeAppApiRequest,
  type RomeAppContext,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../db/repositories/teach.js";
import { serializeLesson, serializeLessonSummary, serializeModule } from "../lib/wire.js";
import { buildDashboardData, buildDueReviewsData, buildResourcesData } from "../lib/queries.js";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type JsonResult = { ok: true; value: unknown } | { ok: false; reason: "empty" | "parse_error" };

function readJsonBody(request: RomeAppApiRequest): JsonResult {
  if (!request.body || request.body.byteLength === 0) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(request.body)) };
  } catch {
    return { ok: false, reason: "parse_error" };
  }
}

function unwrap(result: { status: string; data?: unknown; error?: string }): Response {
  if (result.status !== "ok") {
    const error = result.status === "error" ? result.error : `action returned ${result.status}`;
    const status = typeof error === "string" && /not found/i.test(error) ? 404 : 400;
    return json({ error }, { status });
  }
  return json(result.data ?? {});
}

class TeachApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const { method, path } = request;
    const route = path.join("/");

    // GET / — app metadata
    if (method === "GET" && path.length === 0) {
      return json({ appId: this.ctx.app.id, version: this.ctx.app.version, status: "ok" });
    }

    // GET /dashboard — aggregated dashboard data.
    // Read directly against the in-process DB (no runAction subprocess fork).
    if (method === "GET" && route === "dashboard") {
      const repo = createTeachRepository(this.ctx.db);
      const data = await buildDashboardData(repo, () => this.ctx.listRoutines());
      return json(data);
    }

    // POST /missions — create a mission
    if (method === "POST" && route === "missions") {
      const parsed = readJsonBody(request);
      if (!parsed.ok) return json({ error: "request body required" }, { status: 400 });
      const b = parsed.value as Record<string, unknown>;
      return unwrap(
        await this.ctx.runAction("teach_create_mission", {
          title: b.title,
          motivation: b.motivation,
          target_level: b.target_level,
          notes: b.notes,
        }),
      );
    }

    // PUT /settings — update app-global settings (notify channel, daily review
    // time, timezone, routine on/off). Backs the Settings panel.
    if (method === "PUT" && route === "settings") {
      const parsed = readJsonBody(request);
      if (!parsed.ok) return json({ error: "request body required" }, { status: 400 });
      const b = parsed.value as Record<string, unknown>;
      return unwrap(
        await this.ctx.runAction("teach_update_settings", {
          notify_channel: b.notify_channel,
          daily_review_time: b.daily_review_time,
          timezone: b.timezone,
          review_enabled: b.review_enabled,
        }),
      );
    }

    // GET /missions/:id/lessons — syllabus: modules + lesson summaries (no html)
    if (method === "GET" && path[0] === "missions" && path[2] === "lessons" && path.length === 3) {
      const repo = createTeachRepository(this.ctx.db);
      if (!repo.getMission(path[1])) return json({ error: "Mission not found" }, { status: 404 });
      const modules = repo.listModulesByMission(path[1]).map(serializeModule);
      const lessons = repo.listLessonsByMission(path[1]).map(serializeLessonSummary);
      return json({ modules, lessons });
    }

    // POST /missions/:id/lessons — generate a lesson (slow: runs an agent).
    // Pass lesson_id to realize a planned syllabus lesson (JIT); omit to create
    // a new lesson with an optional free-text topic.
    if (method === "POST" && path[0] === "missions" && path[2] === "lessons" && path.length === 3) {
      const parsed = readJsonBody(request);
      const body = parsed.ok ? (parsed.value as Record<string, unknown>) : {};
      return unwrap(
        await this.ctx.runAction("teach_generate_lesson", {
          mission_id: path[1],
          lesson_id: typeof body.lesson_id === "string" && body.lesson_id.trim() ? body.lesson_id : undefined,
          topic: typeof body.topic === "string" && body.topic.trim() ? body.topic : undefined,
        }),
      );
    }

    // POST /missions/:id/outline — design (or re-plan) the syllabus (slow: agent)
    if (method === "POST" && path[0] === "missions" && path[2] === "outline" && path.length === 3) {
      const parsed = readJsonBody(request);
      const body = parsed.ok ? (parsed.value as Record<string, unknown>) : {};
      return unwrap(
        await this.ctx.runAction("teach_generate_outline", {
          mission_id: path[1],
          regen: body.regen === true,
        }),
      );
    }

    // GET /lessons/:id — a single lesson with full html
    if (method === "GET" && path[0] === "lessons" && path.length === 2) {
      const repo = createTeachRepository(this.ctx.db);
      const lesson = repo.getLesson(path[1]);
      if (!lesson) return json({ error: "Lesson not found" }, { status: 404 });
      return json({ lesson: serializeLesson(lesson) });
    }

    // POST /lessons/:id/complete — mark a lesson completed
    if (method === "POST" && path[0] === "lessons" && path[2] === "complete" && path.length === 3) {
      const parsed = readJsonBody(request);
      const body = parsed.ok ? (parsed.value as Record<string, unknown>) : {};
      return unwrap(
        await this.ctx.runAction("teach_complete_lesson", {
          lesson_id: path[1],
          learning_note: typeof body.learning_note === "string" ? body.learning_note : undefined,
        }),
      );
    }

    // GET /reviews/due?mission_id= — due cards grouped by mission.
    // Direct in-process read (no runAction subprocess fork).
    if (method === "GET" && route === "reviews/due") {
      const missionId = request.query.get("mission_id") ?? undefined;
      const repo = createTeachRepository(this.ctx.db);
      if (missionId && !repo.getMission(missionId)) {
        return json({ error: `Mission not found: ${missionId}` }, { status: 404 });
      }
      return json(buildDueReviewsData(repo, { missionId }));
    }

    // POST /reviews/grade { card_id, selected_option?, text?, override_easy? }
    // — submit an active-recall answer; the action derives the SM-2 grade.
    if (method === "POST" && route === "reviews/grade") {
      const parsed = readJsonBody(request);
      if (!parsed.ok) return json({ error: "request body required" }, { status: 400 });
      const b = parsed.value as Record<string, unknown>;
      return unwrap(
        await this.ctx.runAction("teach_grade_review", {
          card_id: b.card_id,
          selected_option: b.selected_option,
          text: b.text,
          override_easy: b.override_easy,
          replace_review_id: b.replace_review_id,
        }),
      );
    }

    // GET /resources?mission_id= — list resources.
    // Direct in-process read (no runAction subprocess fork).
    if (method === "GET" && route === "resources") {
      const missionId = request.query.get("mission_id") ?? undefined;
      const repo = createTeachRepository(this.ctx.db);
      if (missionId && !repo.getMission(missionId)) {
        return json({ error: `Mission not found: ${missionId}` }, { status: 404 });
      }
      return json(buildResourcesData(repo, missionId ?? null));
    }

    // POST /resources — add a resource
    if (method === "POST" && route === "resources") {
      const parsed = readJsonBody(request);
      if (!parsed.ok) return json({ error: "request body required" }, { status: 400 });
      const b = parsed.value as Record<string, unknown>;
      return unwrap(
        await this.ctx.runAction("teach_add_resource", {
          title: b.title,
          url: b.url,
          note: b.note,
          mission_id: b.mission_id,
        }),
      );
    }

    return json(
      { error: "not_found", message: `Unknown Teach API route: ${method} /${route}` },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new TeachApiHandler(ctx);
}
