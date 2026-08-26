import type { Action, ActionConfig, ActionResult, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import {
  buildSeoWorkflowPrompt,
  getSeoWorkflowSpec,
  validateSeoWorkflowArgs,
} from "./workflows.js";

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  const spec = getSeoWorkflowSpec(config.name);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        ...Object.fromEntries(
          spec.fields.map((field) => [
            field.name,
            {
              type: "string",
              description: field.description,
            },
          ]),
        ),
        sessionId: {
          type: "string",
          description: "Optional SEO agent session ID to resume a previous workflow",
        },
      },
      required: spec.fields.filter((field) => field.required).map((field) => field.name),
    },
    async execute(input: Record<string, unknown>): Promise<ActionResult> {
      const validationError = validateSeoWorkflowArgs(config.name, input);
      if (validationError) {
        return { status: "error", error: validationError };
      }

      const sessionId = typeof input.sessionId === "string" ? input.sessionId : undefined;
      const prompt = buildSeoWorkflowPrompt(config.name, input);
      return await deps.appContext.runAction("summon", {
        agentName: "seo",
        prompt,
        sessionId,
      });
    },
  };
}
