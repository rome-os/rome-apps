import {
  defineAction,
  z,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { LarkService } from "../../lib/service.js";
import { checkDocumentAccess } from "../../lib/access-probe.js";
import { safeFailure } from "../../lib/policy.js";
export const accessSchema = z
  .object({
    connectionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
    identity: z.enum(["user", "bot"]),
    doc: z.string().min(1).max(2000),
  })
  .strict();
export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps) {
  return defineAction({
    config,
    schema: accessSchema,
    execute: async (input) => {
      try {
        return {
          status: "ok",
          data: await checkDocumentAccess(
            new LarkService(deps.appContext),
            input,
          ),
        };
      } catch (error) {
        return { status: "error", error: safeFailure(error).code };
      }
    },
  });
}
