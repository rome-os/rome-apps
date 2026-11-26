import {
  defineAction,
  z,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { writeSchema } from "../input.js";
import { LarkService } from "../../lib/service.js";
import { actionErrorMessage } from "../../lib/policy.js";
import { LOCAL_CONNECTION_ID } from "../../shared/managed-connections.js";

export const coreWriteSchema = writeSchema.extend({
  connectionId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,160}$/)
    .refine((id) => id !== LOCAL_CONNECTION_ID, {
      message: "local_write_required: Use lark:write for local-cli connections.",
    }),
  identity: z.literal("bot"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps) {
  return defineAction({
    config,
    schema: coreWriteSchema,
    execute: async (input) => {
      try {
        return {
          status: "ok",
          data: await new LarkService(deps.appContext).invoke(input, "core_write"),
        };
      } catch (error) {
        return { status: "error", error: actionErrorMessage(error) };
      }
    },
  });
}
