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

const log = createAppLogger("survey_design_survey");

interface DesignSurveyInput {
  surveyId: string;
  message: string;
}

interface DesignOutput {
  message: string;
  stage: "clarifying" | "proposal" | "approved";
  title?: string;
  description?: string;
  schemaDefinition?: unknown;
  formDefinition?: unknown;
}

type Deps = AppActionRuntimeDeps<{ agentRunner: AgentRunnerInterface }>;

export function createAction(config: ActionConfig, deps: Deps): Action {
  const { agentRunner, appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        surveyId: { type: "string", description: "Survey ID" },
        message: { type: "string", description: "Merchant message" },
      },
      required: ["surveyId", "message"],
      additionalProperties: false,
    },

    async execute(input): Promise<ActionResult> {
      const { surveyId, message } = input as unknown as DesignSurveyInput;
      const repo = createSurveyRepository(appContext.db);

      const survey = repo.getSurvey(surveyId);
      if (!survey) {
        return { status: "error", error: `Survey ${surveyId} not found` };
      }

      // Persist the merchant message
      repo.addDesignMessage(crypto.randomUUID(), surveyId, "user", message);

      // Use channelThreadKey for prefix cache / session reuse
      const channelThreadKey = `survey-design:${surveyId}`;

      // Check if this is the first message (no prior assistant messages)
      const history = repo.listDesignMessages(surveyId);
      const isFirstTurn = history.filter((m) => m.role === "assistant").length === 0;

      let prompt: string;
      if (isFirstTurn) {
        // First turn: include the full research goal context.
        // This becomes the stable cached context for the session.
        let contextBlock = "";
        if (survey.schemaDefinition) {
          contextBlock += `\n\n## Current Schema Definition\n\`\`\`json\n${survey.schemaDefinition}\n\`\`\``;
        }
        if (survey.formDefinition) {
          contextBlock += `\n\n## Current Form Definition\n\`\`\`json\n${survey.formDefinition}\n\`\`\``;
        }

        prompt = [
          `## Research Goal`,
          survey.goal,
          contextBlock,
          ``,
          `The merchant says: ${message}`,
          ``,
          `Respond to the merchant. Call submit_output with your response.`,
        ].join("\n");
      } else {
        // Subsequent turns: session already has the goal + prior conversation.
        // Only send the new merchant message + current state.
        let stateHint = "";
        if (survey.schemaDefinition) {
          stateHint = `\n(Current schema has ${JSON.parse(survey.schemaDefinition).fields?.length ?? 0} fields)`;
        }

        prompt = [
          `Merchant says: ${message}${stateHint}`,
          ``,
          `Respond to the merchant. Call submit_output with your response.`,
        ].join("\n");
      }

      let structured: DesignOutput | undefined;
      let errorMsg: string | undefined;
      let agentAccounting: AgentAccounting | undefined;

      for await (const msg of agentRunner.run({
        agentName: "survey-design-pro",
        prompt,
        channelThreadKey,
      })) {
        if (msg.type === "structured_output") {
          structured = msg.payload as DesignOutput;
        } else if (msg.type === "result" || msg.type === "error") {
          if (msg.accounting) agentAccounting = msg.accounting;
          if (msg.type === "error") {
            errorMsg = msg.error;
            log.error("design agent error", { surveyId, error: msg.error });
          }
        }
      }

      // Persist accounting data
      if (agentAccounting) {
        try {
          repo.addAccountingRecord({
            id: crypto.randomUUID(),
            surveyId,
            actionType: "design",
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
          log.warn("Failed to persist accounting", { surveyId, error: String(err) });
        }
      }

      if (errorMsg && !structured) {
        return { status: "error", error: `Agent error: ${errorMsg}` };
      }

      if (!structured) {
        return { status: "error", error: "Agent returned no structured output" };
      }

      // Persist the assistant's reply
      repo.addDesignMessage(
        crypto.randomUUID(),
        surveyId,
        "assistant",
        structured.message,
        JSON.stringify({
          stage: structured.stage,
          hasSchema: !!structured.schemaDefinition,
          hasForm: !!structured.formDefinition,
        }),
      );

      // Update survey if the agent included schema/form data
      const updateFields: Record<string, any> = {};
      if (structured.title) updateFields.title = structured.title;
      if (structured.description) updateFields.description = structured.description;
      if (structured.schemaDefinition) updateFields.schemaDefinition = JSON.stringify(structured.schemaDefinition);
      if (structured.formDefinition) updateFields.formDefinition = JSON.stringify(structured.formDefinition);
      if (structured.stage === "approved") updateFields.status = "active";

      if (Object.keys(updateFields).length > 0) {
        repo.updateSurvey(surveyId, updateFields);
      }

      log.info("design turn completed", {
        surveyId,
        stage: structured.stage,
        isFirstTurn,
        hasSchema: !!structured.schemaDefinition,
      });

      return {
        status: "ok",
        data: {
          message: structured.message,
          stage: structured.stage,
          title: structured.title,
          description: structured.description,
          schemaDefinition: structured.schemaDefinition,
          formDefinition: structured.formDefinition,
        },
      };
    },
  };
}
