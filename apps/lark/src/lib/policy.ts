import type { CurrentActionContext } from "@rome-os/app-runtime";
import {
  findCommand,
  coreCommand,
  type CommandSpec,
  type Identity,
} from "../shared/catalog.js";

export class LarkError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail = "",
    public readonly uncertain = false,
  ) {
    super(code);
  }
}
export function assertGuardian(
  context: CurrentActionContext | undefined,
  approvedWrite = false,
): void {
  const thread = context?.channelContext;
  if (!thread) {
    if (context?.callerAppId === "lark") return;
    // Approval replay is a new root and may omit the original API callerAppId.
    // Only the engine-executed, requiresApproval write action can use this path.
    if (
      approvedWrite &&
      context?.actionName === "lark:approve_local_write" &&
      context.executionId
    )
      return;
    throw new LarkError("guardian_context_required");
  }
  if (thread.threadType !== "private")
    throw new LarkError("private_chat_required");
  if (thread.senderBondLevel === "guardian") return;
  if (thread.channel === "webchat" && !thread.senderBondLevel) return;
  throw new LarkError("guardian_context_required");
}
export interface Invocation {
  spec: CommandSpec;
  identity: Identity;
  parameters: Record<string, string | number>;
  argv: string[];
  stdin?: string;
}
export function prepareInvocation(
  id: string,
  identity: Identity,
  input: Record<string, unknown>,
  risk?: "read" | "write",
  core = false,
): Invocation {
  const spec = core ? coreCommand(findCommand(id)) : findCommand(id);
  if (risk && spec.risk !== risk)
    throw new LarkError("wrong_action_for_command");
  if (core && (!spec.coreOperation || identity !== "bot"))
    throw new LarkError("core_user_identity_unsupported");
  if (!spec.identities.includes(identity))
    throw new LarkError("identity_not_allowed");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new LarkError("invalid_parameters");
  for (const key of Object.keys(input))
    if (!Object.hasOwn(spec.fields, key))
      throw new LarkError("parameter_not_allowed", key);
  const parameters: Record<string, string | number> = {};
  const argv = [...spec.argv, `--as=${identity}`];
  let stdin: string | undefined;
  for (const [key, field] of Object.entries(spec.fields)) {
    const value = input[key] ?? field.default;
    if (value === undefined || value === "") {
      if (field.required) throw new LarkError("missing_parameter", key);
      continue;
    }
    if (field.type === "integer") {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < (field.min ?? 0) ||
        value > (field.max ?? 1000000)
      )
        throw new LarkError("invalid_parameter", key);
    } else {
      if (
        typeof value !== "string" ||
        value.length > (field.max ?? 500) ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
      )
        throw new LarkError("invalid_parameter", key);
      if (
        !core &&
        !field.stdin &&
        (value.trimStart().startsWith("@") || value.trim() === "-")
      )
        throw new LarkError("file_input_not_allowed", key);
      if (field.enum && !field.enum.includes(value))
        throw new LarkError("invalid_parameter", key);
      if (["url", "doc", "node-token"].includes(key) && value.includes("://")) {
        let u: URL;
        try {
          u = new URL(value);
        } catch {
          throw new LarkError("invalid_resource_url", key);
        }
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          !/^(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com|larkoffice\.com)$/i.test(
            u.hostname,
          )
        )
          throw new LarkError("invalid_resource_url", key);
      }
      if (
        !core &&
        key === "content" &&
        /!\[|<\s*(?:img|image|file|iframe|script|media)\b|data:|file:/i.test(
          value,
        )
      )
        throw new LarkError("media_input_not_allowed", key);
    }
    parameters[key] = value as string | number;
    if (field.stdin) {
      argv.push(`--${key}=-`);
      stdin = String(value);
    } else argv.push(`--${key}=${value}`);
  }
  if (
    spec.id === "docs.fetch" &&
    parameters.scope === "keyword" &&
    !parameters.keyword
  )
    throw new LarkError("missing_parameter", "keyword");
  if (
    core &&
    spec.id === "calendar.agenda" &&
    parameters["page-token"] !== undefined &&
    (parameters.start !== undefined || parameters.end !== undefined)
  )
    throw new LarkError("invalid_input");
  if (spec.id === "calendar.create") {
    for (const key of ["start", "end"])
      if (
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(
          String(parameters[key]),
        ) ||
        !Number.isFinite(Date.parse(String(parameters[key])))
      )
        throw new LarkError("timezone_required", key);
    if (
      Math.floor(Date.parse(String(parameters.end)) / 1000) <=
      Math.floor(Date.parse(String(parameters.start)) / 1000)
    )
      throw new LarkError("invalid_time_range");
  }
  for (const [key, value] of Object.entries(spec.fixed ?? {}))
    argv.push(`--${key}=${value}`);
  return { spec, identity, parameters, argv, stdin };
}
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 24) return "[depth limited]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /(?:app.?secret|access.?token|refresh.?token|device.?code|client.?secret|authorization|cookie|private.?key|api.?key)/i.test(
          k,
        )
          ? "[redacted]"
          : redact(v, depth + 1),
      ]),
    );
  return typeof value === "string"
    ? value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    : value;
}
export function safeFailure(error: unknown): {
  code: string;
  detail: string;
  uncertain: boolean;
} {
  if (error instanceof Error && error.message === "command_not_allowed")
    return { code: "command_not_allowed", detail: "", uncertain: false };
  if (error instanceof LarkError)
    return {
      code: error.code,
      detail: error.detail,
      uncertain: error.uncertain,
    };
  return { code: "internal_error", detail: "", uncertain: false };
}

export function actionErrorMessage(error: unknown): string {
  const { code, detail } = safeFailure(error);
  if (code === "core_operation_not_granted")
    return `${code}: Grant ${detail} in Rome Settings → the Feishu connection details.`;
  if (code === "core_user_identity_unsupported")
    return `${code}: Core Feishu connections support bot identity. For user-only commands, explicitly select local-cli until Core supports User OAuth.`;
  if (code === "core_write_required")
    return `${code}: Use lark:core_write for managed Core connections.`;
  if (code === "local_write_required")
    return `${code}: Use lark:write for local-cli connections.`;
  return code;
}
