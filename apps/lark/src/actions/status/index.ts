import {
  defineAction,
  z,
  getCurrentActionContext,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { CoreBrokerClient } from "../../lib/core-broker.js";
import { LarkService } from "../../lib/service.js";
import { assertGuardian, safeFailure } from "../../lib/policy.js";
export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return defineAction({
    config,
    schema: z
      .object({
        connectionId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,160}$/)
          .optional(),
      })
      .strict(),
    execute: async ({ connectionId }) => {
      try {
        assertGuardian(getCurrentActionContext());
        return {
          status: "ok",
          data:
            connectionId && connectionId !== "local-cli"
              ? {
                  ...(await new CoreBrokerClient(
                    deps.appContext.connections,
                  ).describe(connectionId)),
                  preferences: new LarkService(
                    deps.appContext,
                  ).repo.preferences(),
                }
              : await new LarkService(deps.appContext).status(),
        };
      } catch (e) {
        return { status: "error", error: safeFailure(e).code };
      }
    },
  });
}
