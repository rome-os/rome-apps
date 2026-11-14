import { defineAction, z, type Action, type ActionConfig, type AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { platformAliasList } from "../../lib/platforms.js";
import { AppError, msg, render } from "../../lib/messages.js";
import { guarded } from "../../lib/runtime.js";

const schema = z.object({
  query: z
    .string()
    .default("")
    .describe("English keywords matched against path/summary, e.g. 'user profile', 'search video', 'comment', 'hot list'. Empty lists the platform's endpoints."),
  platform: z
    .string()
    .optional()
    .describe(`Platform alias to narrow results: ${platformAliasList().join(", ")}`),
  tag: z.string().optional().describe("Exact OpenAPI tag, e.g. 'Xiaohongshu-App-V2-API'"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max results (default 10)"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: ({ query, platform, tag, limit }) =>
      guarded(deps, async (svc) => {
        const res = await svc.search({ query, platform, tag, limit });
        if (res.unknownPlatform) {
          throw new AppError(msg("search.unknownPlatform", { value: res.unknownPlatform, known: platformAliasList().join(", ") }));
        }
        return {
          schemaVersion: res.schemaVersion,
          platform: res.platform,
          total: res.total,
          results: res.items.map((op) => ({
            method: op.method.toUpperCase(),
            path: op.path,
            tag: op.tag,
            summary: op.summary,
            brief: op.brief,
            costUsd: op.costUsd,
            ...(op.guarded ? { guarded: true } : {}),
          })),
          next: render(msg("hint.searchNext"), svc.lang),
        };
      }),
  });
}
