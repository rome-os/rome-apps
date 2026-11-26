import { findCommand, type Identity } from "../shared/catalog.js";
import { LOCAL_CONNECTION_ID } from "../shared/managed-connections.js";
import { coreAccessIssue } from "../shared/core-access.js";
import { CoreBrokerClient } from "./core-broker.js";
import { LarkError } from "./policy.js";

export async function resolveConnection(
  input: { connectionId?: string; identity: Identity; command?: string },
  risk: "read" | "write" | "preview",
  broker = new CoreBrokerClient(),
) {
  if (
    input.connectionId === undefined ||
    input.connectionId === LOCAL_CONNECTION_ID
  )
    return undefined;
  const spec = findCommand(input.command ?? "");
  if (risk !== "preview" && spec.risk !== risk)
    throw new LarkError("wrong_action_for_command");
  if (!spec.coreOperation || input.identity !== "bot")
    throw new LarkError("core_user_identity_unsupported");
  const connection = await broker.describe(input.connectionId);
  const issue = coreAccessIssue(spec, input.identity, connection);
  if (issue) throw new LarkError(issue, spec.coreOperation);
  return connection;
}
