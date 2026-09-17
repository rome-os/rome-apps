import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AgentAccounting,
  type AgentRunnerInterface,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createSurveyRepository } from "../../db/repositories/survey.js";

const log = createAppLogger("survey_chat_survey");

interface ChatSurveyInput {
  responseId: string;
  message: string;
}

interface ChatOutput {
  message: string;
  uiBlock?: {
    type: "single_choice" | "multiple_choice" | "rating";
    options?: string[];
    scale?: number;
    lowLabel?: string;
    midLabel?: string;
    highLabel?: string;
    fieldKey?: string;
  } | null;
  /** A JSON object serialized to a string; the portable output schema cannot
   *  express a free-form map. */
  collectedData?: string | null;
  done: boolean;
}

/**
 * The agent returns `collectedData` as a JSON object serialized to a string.
 * A malformed payload loses one turn's answers rather than failing the turn.
 */
function parseCollectedData(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      log.warn("collectedData is not a JSON object", { length: raw.length });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    // The payload is the respondent's own answers, so log its shape only.
    // Node embeds a prefix of the input in the parse error, so it stays out.
    log.warn("collectedData is not valid JSON", { length: raw.length });
    return null;
  }
}

type Deps = AppActionRuntimeDeps<{ agentRunner: AgentRunnerInterface }>;

export function createAction(config: ActionConfig, deps: Deps): Action {
  const { agentRunner, appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        responseId: { type: "string", description: "Survey response ID" },
        message: { type: "string", description: "Consumer message" },
      },
      required: ["responseId", "message"],
      additionalProperties: false,
    },

    async execute(input): Promise<ActionResult> {
      const { responseId, message } = input as unknown as ChatSurveyInput;
      const repo = createSurveyRepository(appContext.db);

      const response = repo.getResponse(responseId);
      if (!response) {
        return { status: "error", error: `Response ${responseId} not found` };
      }

      const survey = repo.getSurvey(response.surveyId);
      if (!survey || !survey.formDefinition) {
        return { status: "error", error: "Survey form not found or not ready" };
      }

      const formDef = JSON.parse(survey.formDefinition);

      // Persist user message
      repo.addResponseMessage(crypto.randomUUID(), responseId, "user", message);

      // Build current collected data
      const currentAnswers = response.answers ? JSON.parse(response.answers) : {};

      // Use channelThreadKey for prefix cache / session reuse.
      const channelThreadKey = `survey-chat:${responseId}`;

      // Check if this is the [START] trigger (live generation of first question)
      const isStartTrigger = message === "[START]";

      // Check if the greeting was pre-cached. If so, the first real user
      // answer arrives without a prior agent session — we need to bootstrap
      // the session with the full form definition + the pre-asked question.
      const chatHistory = repo.listResponseMessages(responseId);
      const assistantMsgCount = chatHistory.filter((m) => m.role === "assistant").length;
      const isFirstRealAnswer = !isStartTrigger && assistantMsgCount <= 1;
      const isFirstTurn = isStartTrigger || isFirstRealAnswer;

      // Strip cachedGreeting from the form def sent to the agent (it's internal)
      const { cachedGreeting, ...cleanFormDef } = formDef as Record<string, unknown>;

      let prompt: string;
      if (isStartTrigger) {
        // Live generation of first question (fallback when no cache)
        prompt = [
          `## Survey Form Definition`,
          `\`\`\`json`,
          JSON.stringify(cleanFormDef, null, 2),
          `\`\`\``,
          ``,
          `The survey is starting. Greet the user briefly and ask the first question.`,
          `Call submit_output with your response.`,
        ].join("\n");
      } else if (isFirstRealAnswer) {
        // First real user answer — the greeting was pre-cached, so this is a
        // new agent session. Include the full form definition as context plus
        // info about what was already asked.
        const priorAssistantMsg = chatHistory.find((m) => m.role === "assistant");
        prompt = [
          `## Survey Form Definition`,
          `\`\`\`json`,
          JSON.stringify(cleanFormDef, null, 2),
          `\`\`\``,
          ``,
          `The survey has started. You already greeted the user and asked the first question:`,
          `"${priorAssistantMsg?.content ?? "(greeting)"}"`,
          ``,
          `User answered: ${message}`,
          `Data collected so far: ${JSON.stringify(currentAnswers)}`,
          ``,
          `Extract data from this answer, then continue with the next question.`,
          `Call submit_output with your response.`,
        ].join("\n");
      } else {
        // Subsequent turns: session already has context from prior turns.
        prompt = [
          `User answered: ${message}`,
          ``,
          `Data collected so far: ${JSON.stringify(currentAnswers)}`,
          ``,
          `Continue the survey. Ask the next relevant question, or if all questions and open-ended topics are covered, thank the user and set done: true.`,
          `Call submit_output with your response.`,
        ].join("\n");
      }

      let structured: ChatOutput | undefined;
      let errorMsg: string | undefined;
      let agentAccounting: AgentAccounting | undefined;

      for await (const msg of agentRunner.run({
        agentName: "survey-chat",
        prompt,
        channelThreadKey,
      })) {
        if (msg.type === "structured_output") {
          structured = msg.payload as ChatOutput;
        } else if (msg.type === "result" || msg.type === "error") {
          if (msg.accounting) agentAccounting = msg.accounting;
          if (msg.type === "error") {
            errorMsg = msg.error;
            log.error("chat agent error", { responseId, error: msg.error });
          }
        }
      }

      // Persist accounting data
      if (agentAccounting) {
        try {
          repo.addAccountingRecord({
            id: crypto.randomUUID(),
            surveyId: response.surveyId,
            responseId,
            actionType: "chat",
            provider: agentAccounting.provider,
            model: agentAccounting.model,
            inputTokens: agentAccounting.usage?.inputTokens ?? 0,
            outputTokens: agentAccounting.usage?.outputTokens ?? 0,
            cacheReadTokens: agentAccounting.usage?.cacheReadTokens ?? 0,
            cacheWriteTokens: agentAccounting.usage?.cacheWriteTokens ?? 0,
            costUsd: agentAccounting.costUsd,
            durationMs: agentAccounting.durationMs,
          });
        } catch (err) {
          log.warn("Failed to persist accounting", { responseId, error: String(err) });
        }
      }

      if (errorMsg && !structured) {
        return { status: "error", error: `Agent error: ${errorMsg}` };
      }

      if (!structured) {
        return { status: "error", error: "Agent returned no structured output" };
      }

      // Persist the assistant's reply with UI block
      repo.addResponseMessage(
        crypto.randomUUID(),
        responseId,
        "assistant",
        structured.message,
        structured.uiBlock ? JSON.stringify(structured.uiBlock) : undefined,
      );

      // Merge collected data into response answers
      const collected = parseCollectedData(structured.collectedData);
      if (collected && Object.keys(collected).length > 0) {
        const merged = { ...currentAnswers, ...collected };
        repo.updateResponse(responseId, { answers: JSON.stringify(merged) });
      }

      // Mark completed if done
      if (structured.done) {
        repo.updateResponse(responseId, { status: "completed" });
      }

      log.info("chat turn completed", {
        responseId,
        done: structured.done,
        isFirstTurn,
        fieldsCollected: collected ? Object.keys(collected) : [],
      });

      return {
        status: "ok",
        data: {
          message: structured.message,
          uiBlock: structured.uiBlock || null,
          done: structured.done,
        },
      };
    },
  };
}
