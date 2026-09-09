import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createDistillationsRepository } from "../../db/repositories/distillations.js";

type GetDeps = AppActionRuntimeDeps;

export function createAction(config: ActionConfig, deps: GetDeps): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Distillation id" },
        // When true, only a featured (public sample) record is returned; used
        // for anonymous visitors so private history stays hidden.
        publicOnly: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },

    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const id = input.id;
      if (typeof id !== "string" || !id) {
        return { status: "error", error: "A distillation id is required." };
      }
      const publicOnly = (input as { publicOnly?: unknown }).publicOnly === true;
      const repo = createDistillationsRepository(appContext.db);
      const row = repo.byId(id);
      if (!row || (publicOnly && !row.featured)) {
        return { status: "error", error: "Distillation not found." };
      }
      return {
        status: "ok",
        data: {
          id: row.id,
          url: row.url,
          videoId: row.videoId,
          title: row.title,
          channel: row.channel,
          lang: row.lang,
          transcript: row.transcript,
          status: row.status,
          errorMessage: row.errorMessage,
          errorCode: row.errorCode,
          requestedTypes: row.requestedTypes,
          mindmapMd: row.mindmapMd,
          summaryMd: row.summaryMd,
          slidesHtml: row.slidesHtml,
          featured: row.featured,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  };
}
