import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AgentRunnerInterface,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";

const log = createAppLogger("summary_ask_agent");

interface AskAgentInput {
  prompt: string;
}

type AskAgentDeps = AppActionRuntimeDeps<{ agentRunner: AgentRunnerInterface }>;

export function createAction(
  config: ActionConfig,
  deps: AskAgentDeps,
): Action {
  const { agentRunner } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt to send to the demo agent" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const { prompt } = input as unknown as AskAgentInput;
      log.info("ask-agent invoked", { prompt });

      // agentRunner.run yields a stream of messages for the agent turn.
      // Collect the final `result` and any structured payload the agent
      // submitted via its `outputSchema` (see demo.yaml). The runtime emits
      // `structured_output` only after the payload has passed schema
      // validation and exactly-once enforcement, so it's safe to take as-is.
      let result = "";
      let structured: unknown;
      for await (const msg of agentRunner.run({
        agentName: "summary",
        prompt,
      })) {
        if (msg.type === "result") {
          result = msg.content;
        } else if (msg.type === "error") {
          log.error("agent failed", { error: msg.error });
          return { status: "error", error: `Agent failed: ${msg.error}` };
        } else if (msg.type === "structured_output") {
          structured = msg.payload;
        }
      }

      return { status: "ok", data: { result, structured } };
    },
  };
}
