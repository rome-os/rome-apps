import { defineAction, z, type Action, type ActionConfig, type AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { callActionResult, guardedResult } from "../../lib/runtime.js";

const schema = z.object({
  url: z.string().trim().min(8).describe("Douyin/TikTok video URL, short link, or full share text containing one"),
  minimal: z.boolean().default(true).describe("Return TikHub's minimal field set (default true, much smaller)"),
  maxChars: z.number().int().min(2000).max(200000).default(20000).describe("Serialized character budget for data and pagination together; fixed status/cost metadata is additional"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: ({ url, minimal, maxChars }) =>
      guardedResult(deps, async (svc) => {
        const out = await svc.call(
          { method: "GET", path: "/api/v1/hybrid/video_data", query: { url, minimal }, maxChars },
          "agent",
        );
        return callActionResult(out, svc.lang);
      }),
  });
}
