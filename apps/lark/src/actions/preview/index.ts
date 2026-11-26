import { coreInput } from "../../lib/core-commands.js";
import {
  defineAction,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
  getCurrentActionContext,
} from "@rome-os/app-runtime";
import { invocationSchema } from "../input.js";
import { CoreBrokerClient } from "../../lib/core-broker.js";
import { resolveConnection } from "../../lib/connection-policy.js";
import { LOCAL_CONNECTION_ID } from "../../shared/managed-connections.js";
import {
  prepareInvocation,
  actionErrorMessage,
  assertGuardian,
} from "../../lib/policy.js";
export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return defineAction({
    config,
    schema: invocationSchema,
    execute: async (input) => {
      try {
        assertGuardian(getCurrentActionContext());
        const isCore =
          input.connectionId !== undefined &&
          input.connectionId !== LOCAL_CONNECTION_ID;
        const call = prepareInvocation(
          input.command,
          input.identity,
          input.parameters,
          undefined,
          isCore,
        );
        const brokerInput = isCore ? coreInput(call) : undefined;
        const connection = await resolveConnection(
          input,
          "preview",
          new CoreBrokerClient(deps.appContext.connections),
        );
        return {
          status: "ok",
          data: {
            command: call.spec.id,
            connectionId: connection?.connectionId ?? LOCAL_CONNECTION_ID,
            identity: call.identity,
            risk: call.spec.risk,
            ...(connection && {
              operation: call.spec.coreOperation,
              brokerInput,
            }),
            parameters: call.parameters,
            requiresApproval: call.spec.risk === "write",
            executed: false,
          },
        };
      } catch (e) {
        return { status: "error", error: actionErrorMessage(e) };
      }
    },
  });
}
