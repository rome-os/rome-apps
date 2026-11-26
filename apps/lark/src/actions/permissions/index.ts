import {
  defineAction,
  z,
  getCurrentActionContext,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { LarkService } from "../../lib/service.js";
import { LarkError } from "../../lib/policy.js";
import { CoreBrokerClient } from "../../lib/core-broker.js";
import { assertGuardian, safeFailure } from "../../lib/policy.js";
export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps) {
  return defineAction({
    config,
    schema: z
      .object({ connectionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) })
      .strict(),
    execute: async ({ connectionId }) => {
      try {
        assertGuardian(getCurrentActionContext());
        if (!new LarkService(deps.appContext).repo.preferences().agentEnabled)
          throw new LarkError("agent_access_disabled");
        return {
          status: "ok",
          data: await new CoreBrokerClient(
            deps.appContext.connections,
          ).permissions(connectionId),
        };
      } catch (error) {
        return { status: "error", error: safeFailure(error).code };
      }
    },
  });
}
