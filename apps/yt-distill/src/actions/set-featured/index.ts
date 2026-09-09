import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createDistillationsRepository } from "../../db/repositories/distillations.js";

type SetFeaturedDeps = AppActionRuntimeDeps;

export function createAction(config: ActionConfig, deps: SetFeaturedDeps): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Distillation id" },
        featured: { type: "boolean", description: "true = show as a public sample" },
      },
      required: ["id", "featured"],
      additionalProperties: false,
    },

    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const id = input.id;
      const featured = input.featured;
      if (typeof id !== "string" || !id) {
        return { status: "error", error: "A distillation id is required." };
      }
      if (typeof featured !== "boolean") {
        return { status: "error", error: "featured must be a boolean." };
      }
      const repo = createDistillationsRepository(appContext.db);
      const row = repo.setFeatured(id, featured);
      if (!row) return { status: "error", error: "Distillation not found." };
      return { status: "ok", data: { id, featured: row.featured } };
    },
  };
}
