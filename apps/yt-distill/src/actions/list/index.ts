import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createDistillationsRepository } from "../../db/repositories/distillations.js";

type ListDeps = AppActionRuntimeDeps;

export function createAction(config: ActionConfig, deps: ListDeps): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        // "all" (owner) returns everything; "featured" returns only public samples.
        scope: { type: "string", enum: ["all", "featured"] },
      },
      additionalProperties: false,
    },

    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const featuredOnly = (input as { scope?: unknown }).scope === "featured";
      const repo = createDistillationsRepository(appContext.db);
      const items = repo.list(100, featuredOnly).map((row) => ({
        id: row.id,
        url: row.url,
        videoId: row.videoId,
        title: row.title,
        channel: row.channel,
        status: row.status,
        errorMessage: row.errorMessage,
        errorCode: row.errorCode,
        requestedTypes: row.requestedTypes,
        featured: row.featured,
        artifacts: {
          mindmap: row.mindmapMd != null,
          summary: row.summaryMd != null,
          slides: row.slidesHtml != null,
        },
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
      return { status: "ok", data: { items } };
    },
  };
}
