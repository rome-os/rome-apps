import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createAppLogger } from "@rome-os/app-runtime";
import { createSurveyRepository, type SurveyRepository } from "../db/repositories/survey.js";

const log = createAppLogger("survey_api");

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type JsonBody<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "empty" | "parse_error" };

function readJsonBody<T>(request: RomeAppApiRequest): JsonBody<T> {
  if (!request.body || request.body.byteLength === 0) {
    return { ok: false, reason: "empty" };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(request.body)) as T };
  } catch {
    return { ok: false, reason: "parse_error" };
  }
}

async function loadRepo(ctx: RomeAppContext): Promise<SurveyRepository> {
  const modUrl = new URL("../db/repositories/survey.js", import.meta.url);
  const mod = await import(`${modUrl.href}?v=${Date.now()}`);
  return mod.createSurveyRepository(ctx.db);
}

class SurveyApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");
    const repo = await loadRepo(this.ctx);

    /* ── App info ──────────────────────────────────────────────── */
    if (request.method === "GET" && request.path.length === 0) {
      return json({ appId: this.ctx.app.id, version: this.ctx.app.version, status: "ok" });
    }

    /* ══════════════════════════════════════════════════════════════
       Merchant APIs (session-gated)
       ══════════════════════════════════════════════════════════════ */

    /* ── List surveys ─────────────────────────────────────────── */
    if (request.method === "GET" && route === "surveys") {
      const surveys = repo.listSurveys();
      // Attach response counts
      const surveysWithCounts = surveys.map((s) => ({
        ...s,
        responseCount: repo.countResponses(s.id),
      }));
      return json({ surveys: surveysWithCounts });
    }

    /* ── Create survey ────────────────────────────────────────── */
    if (request.method === "POST" && route === "surveys") {
      const parsed = readJsonBody<{ goal: string; title?: string }>(request);
      if (!parsed.ok) return json({ error: "request body required" }, { status: 400 });
      const { goal, title } = parsed.value;
      if (!goal) return json({ error: "goal is required" }, { status: 400 });

      const id = crypto.randomUUID();
      const survey = repo.createSurvey(id, title || "Untitled Survey", goal);
      return json({ survey }, { status: 201 });
    }

    /* ── Get survey detail ────────────────────────────────────── */
    if (request.method === "GET" && request.path[0] === "surveys" && request.path.length === 2) {
      const survey = repo.getSurvey(request.path[1]);
      if (!survey) return json({ error: "not_found" }, { status: 404 });
      return json({ survey });
    }

    /* ── Delete survey ────────────────────────────────────────── */
    if (request.method === "DELETE" && request.path[0] === "surveys" && request.path.length === 2) {
      repo.deleteSurvey(request.path[1]);
      return json({ ok: true });
    }

    /* ── Design chat: send merchant message ───────────────────── */
    if (
      request.method === "POST" &&
      request.path[0] === "surveys" &&
      request.path[2] === "chat" &&
      request.path.length === 3
    ) {
      const surveyId = request.path[1];
      const parsed = readJsonBody<{ message: string }>(request);
      if (!parsed.ok || !parsed.value.message) {
        return json({ error: "message is required" }, { status: 400 });
      }

      const result = await this.ctx.runAction("survey_design_survey", {
        surveyId,
        message: parsed.value.message,
      });

      if (result.status !== "ok") {
        return json({ error: result.status === "error" ? result.error : "Action failed" }, { status: 500 });
      }

      return json({ reply: result.data });
    }

    /* ── Design chat: get history ─────────────────────────────── */
    if (
      request.method === "GET" &&
      request.path[0] === "surveys" &&
      request.path[2] === "messages" &&
      request.path.length === 3
    ) {
      const surveyId = request.path[1];
      const messages = repo.listDesignMessages(surveyId);
      return json({ messages });
    }

    /* ── Approve survey (transition to active) ────────────────── */
    if (
      request.method === "POST" &&
      request.path[0] === "surveys" &&
      request.path[2] === "approve" &&
      request.path.length === 3
    ) {
      const surveyId = request.path[1];
      const survey = repo.getSurvey(surveyId);
      if (!survey) return json({ error: "not_found" }, { status: 404 });
      if (!survey.formDefinition) return json({ error: "form not designed yet" }, { status: 400 });

      // Pre-generate the first question so consumers get instant start.
      // We create a temporary response, run the agent, extract the greeting,
      // then delete the temp response and store the result in formDefinition.
      const formDef = JSON.parse(survey.formDefinition);
      if (!formDef.cachedGreeting) {
        const tempResponseId = crypto.randomUUID();
        repo.createResponse(tempResponseId, surveyId, "__pregenerate__");
        try {
          log.info("Pre-generating greeting for survey", { surveyId, tempResponseId });
          const initResult = await this.ctx.runAction("survey_chat_survey", {
            responseId: tempResponseId,
            message: "[START]",
          });
          log.info("Pre-generate agent result", { surveyId, success: initResult.status === "ok", hasData: initResult.status === "ok" && !!initResult.data, error: initResult.status === "error" ? initResult.error : undefined });
          if (initResult.status === "ok" && initResult.data) {
            const d = initResult.data as { message: string; uiBlock: unknown; done: boolean };
            formDef.cachedGreeting = {
              message: d.message,
              uiBlock: d.uiBlock || null,
            };
            repo.updateSurvey(surveyId, {
              formDefinition: JSON.stringify(formDef),
            });
            log.info("Pre-generated survey greeting stored", { surveyId, msgLen: d.message?.length });
          }
        } catch (err) {
          log.warn("Failed to pre-generate greeting, consumers will get live generation", {
            surveyId, error: String(err),
          });
        }
        // Clean up temp response and its messages
        repo.deleteResponse(tempResponseId);
      }

      repo.updateSurvey(surveyId, { status: "active" });
      return json({ ok: true, status: "active" });
    }

    /* ── Get accounting summary for a survey ────────────────── */
    if (
      request.method === "GET" &&
      request.path[0] === "surveys" &&
      request.path[2] === "accounting" &&
      request.path.length === 3
    ) {
      const surveyId = request.path[1];
      const survey = repo.getSurvey(surveyId);
      if (!survey) return json({ error: "not_found" }, { status: 404 });
      const summary = repo.getAccountingSummary(surveyId);
      return json({ accounting: summary });
    }

    /* ── List responses for a survey ──────────────────────────── */
    if (
      request.method === "GET" &&
      request.path[0] === "surveys" &&
      request.path[2] === "responses" &&
      request.path.length === 3
    ) {
      const surveyId = request.path[1];
      const responses = repo.listResponses(surveyId);
      const total = repo.countResponses(surveyId);
      const tokenMap = repo.getResponseAccountingMap(surveyId);
      return json({ responses, total, tokenMap });
    }

    /* ── Get single response detail with chat history ─────────── */
    if (
      request.method === "GET" &&
      request.path[0] === "surveys" &&
      request.path[2] === "responses" &&
      request.path.length === 4
    ) {
      const responseId = request.path[3];
      const resp = repo.getResponse(responseId);
      if (!resp) return json({ error: "not_found" }, { status: 404 });
      const messages = repo.listResponseMessages(responseId);
      const accounting = repo.getResponseAccountingSummary(responseId);
      return json({ response: resp, messages, accounting });
    }

    /* ══════════════════════════════════════════════════════════════
       Consumer APIs (public — prefixed with /public/)
       ══════════════════════════════════════════════════════════════ */

    /* ── Get survey form for respondents ──────────────────────── */
    if (
      request.method === "GET" &&
      request.path[0] === "public" &&
      request.path[1] === "surveys" &&
      request.path.length === 3
    ) {
      const surveyId = request.path[2];
      const survey = repo.getSurvey(surveyId);
      if (!survey || survey.status !== "active") {
        return json({ error: "survey not found or not active" }, { status: 404 });
      }
      return json({
        survey: {
          id: survey.id,
          title: survey.title,
          description: survey.description,
        },
      });
    }

    /* ── Start a survey response ──────────────────────────────── */
    if (
      request.method === "POST" &&
      request.path[0] === "public" &&
      request.path[1] === "surveys" &&
      request.path[2] === "respond" &&
      request.path.length === 3
    ) {
      const parsed = readJsonBody<{ surveyId: string; respondentId?: string }>(request);
      if (!parsed.ok || !parsed.value.surveyId) {
        return json({ error: "surveyId is required" }, { status: 400 });
      }
      const { surveyId, respondentId } = parsed.value;

      const survey = repo.getSurvey(surveyId);
      if (!survey || survey.status !== "active") {
        return json({ error: "survey not found or not active" }, { status: 404 });
      }

      const responseId = crypto.randomUUID();
      repo.createResponse(responseId, surveyId, respondentId);

      // Check for pre-generated greeting (instant start)
      const formDef = JSON.parse(survey.formDefinition!);
      if (formDef.cachedGreeting) {
        // Use cached greeting — zero wait time for the consumer!
        const cached = formDef.cachedGreeting as { message: string; uiBlock: unknown };
        // Persist the cached greeting as the first assistant message so
        // the chat history is consistent when the user answers.
        repo.addResponseMessage(crypto.randomUUID(), responseId, "assistant", cached.message,
          cached.uiBlock ? JSON.stringify(cached.uiBlock) : undefined);
        const resp = repo.getResponse(responseId);
        return json({
          response: resp,
          initialReply: { message: cached.message, uiBlock: cached.uiBlock, done: false },
        }, { status: 201 });
      }

      // Fallback: no cached greeting, call the agent live
      const initResult = await this.ctx.runAction("survey_chat_survey", {
        responseId,
        message: "[START]",
      });

      const resp = repo.getResponse(responseId);
      return json({ response: resp, initialReply: initResult.status === "ok" ? initResult.data : null }, { status: 201 });
    }

    /* ── Consumer chat: send message ──────────────────────────── */
    if (
      request.method === "POST" &&
      request.path[0] === "public" &&
      request.path[1] === "responses" &&
      request.path[2] === "chat" &&
      request.path.length === 3
    ) {
      const parsed = readJsonBody<{ responseId: string; message: string }>(request);
      if (!parsed.ok || !parsed.value.responseId || !parsed.value.message) {
        return json({ error: "responseId and message are required" }, { status: 400 });
      }

      const result = await this.ctx.runAction("survey_chat_survey", {
        responseId: parsed.value.responseId,
        message: parsed.value.message,
      });

      if (result.status !== "ok") {
        return json({ error: result.status === "error" ? result.error : "Action failed" }, { status: 500 });
      }

      return json({ reply: result.data });
    }

    /* ── Consumer: get response message history ───────────────── */
    if (
      request.method === "GET" &&
      request.path[0] === "public" &&
      request.path[1] === "responses" &&
      request.path.length === 3
    ) {
      const responseId = request.path[2];
      const resp = repo.getResponse(responseId);
      if (!resp) return json({ error: "not_found" }, { status: 404 });
      const messages = repo.listResponseMessages(responseId);
      return json({ response: resp, messages });
    }

    /* ── 404 fallback ─────────────────────────────────────────── */
    return json(
      { error: "not_found", message: `Unknown route: /${route}` },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new SurveyApiHandler(ctx);
}
