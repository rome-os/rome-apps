import { defineAction, z, type Action, type ActionConfig, type AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { callActionResult, guardedResult } from "../../lib/runtime.js";

const schema = z.object({
  path: z.string().trim().min(1).describe("Endpoint path from tikhub_search_endpoints, e.g. /api/v1/douyin/app/v3/fetch_one_video"),
  method: z.string().optional().describe("GET or POST; defaults to the documented method"),
  query: z.record(z.string(), z.unknown()).optional().describe("Query parameters object"),
  body: z.unknown().optional().describe("JSON body for public read POSTs only; never include credentials or cookies"),
  pathParams: z.record(z.string(), z.unknown()).optional().describe("Values for {placeholders} in the path"),
  confirm: z.boolean().default(false).describe("Deprecated compatibility flag; ignored. Private credentials and mutating endpoints are disabled."),
  dryRun: z.boolean().default(false).describe("Validate and build the request URL without sending it (no credits)"),
  maxChars: z.number().int().min(2000).max(200000).default(30000).describe("Serialized character budget for data and pagination together (default 30000); fixed status/cost metadata is additional. Oversized cursors are omitted, never shortened."),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: (args) =>
      guardedResult(deps, async (svc) => {
        const out = await svc.call(args, "agent");
        return callActionResult(out, svc.lang);
      }),
  });
}
