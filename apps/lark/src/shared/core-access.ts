import type {
  AppConnectionDescription,
  AppConnectionOperation,
} from "@rome-os/app-runtime";
import type { CommandSpec, Identity } from "./catalog.js";

export interface CoreConnection {
  connectionId: string;
  label: string;
  act: AppConnectionDescription["act"];
  identities: { bot: { available: boolean }; user: { available: false } };
  operations: AppConnectionOperation[];
  grantedOperations: string[];
}

export function coreAccessIssue(
  spec: CommandSpec,
  identity: Identity,
  connection?: CoreConnection,
) {
  if (!spec.coreOperation || identity !== "bot")
    return "core_user_identity_unsupported";
  if (!connection) return "connection_unavailable";
  if (!connection.grantedOperations.includes(spec.coreOperation))
    return "core_operation_not_granted";
  if (connection.act.state !== "available") return "connection_unavailable";
  // Core-owned writes depend on the installed actor requiring approval.
  if (
    spec.risk === "write" &&
    !connection.operations.some(
      (op) =>
        op.name === spec.coreOperation &&
        op.approval === "required" &&
        op.sideEffects === "write",
    )
  )
    return "core_approval_unavailable";
  return undefined;
}
