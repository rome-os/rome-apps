import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createDistillationsRepository } from "../../db/repositories/distillations.js";

type RemoveDeps = AppActionRuntimeDeps;

export function createAction(config: ActionConfig, deps: RemoveDeps): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Distillation id" } },
      required: ["id"],
      additionalProperties: false,
    },

    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const id = input.id;
      if (typeof id !== "string" || !id) {
        return { status: "error", error: "A distillation id is required." };
      }
      const repo = createDistillationsRepository(appContext.db);
      const removed = repo.remove(id);
      if (!removed) return { status: "error", error: "Distillation not found." };
      return { status: "ok", data: { id, removed: true } };
    },
  };
}
