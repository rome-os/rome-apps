import { commandDetails } from "../lib/command-details.js";
import { createHash } from "node:crypto";
import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { COMMANDS, AUTH_SCOPE_GROUPS, findCommand } from "../shared/catalog.js";
import { CoreBrokerClient } from "../lib/core-broker.js";
import { coreInput } from "../lib/core-commands.js";
import { LarkService } from "../lib/service.js";
import { publicJob, startSetup, cancelSetup } from "../lib/setup.js";
import {
  LarkError,
  safeFailure,
  actionErrorMessage,
  prepareInvocation,
} from "../lib/policy.js";
import { accessSchema } from "../actions/check-access/index.js";
import { invocationSchema, writeSchema } from "../actions/input.js";
import { resolveConnection } from "../lib/connection-policy.js";
import { LOCAL_CONNECTION_ID } from "../shared/managed-connections.js";
function body(request: RomeAppApiRequest): Record<string, unknown> {
  if (!request.body || request.body.byteLength > 128 * 1024)
    throw new LarkError("invalid_json");
  try {
    const value = JSON.parse(new TextDecoder().decode(request.body));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new LarkError("invalid_json");
  }
}
class LarkApi implements RomeAppApiHandler {
  private service: LarkService;
  private cache?: { at: number; value: unknown };
  constructor(private ctx: RomeAppContext) {
    this.service = new LarkService(ctx);
  }
  async handle(request: RomeAppApiRequest): Promise<Response> {
    // This app operates the owner's personal account; sharing does not delegate it.
    if (request.caller.kind !== "guardian")
      return Response.json({ error: "forbidden" }, { status: 403 });
    const route = request.path.join("/");
    const method = request.method.toUpperCase();
    if (method !== "GET" && request.headers["x-lark-ui"] !== "1")
      return Response.json({ error: "csrf_header_required" }, { status: 403 });
    try {
      if (method === "GET" && route === "connections")
        return Response.json(
          await new CoreBrokerClient(this.ctx.connections).list(
            request.query.get("cursor") ?? undefined,
          ),
        );
      if (
        method === "GET" &&
        request.path[0] === "connections" &&
        request.path.length >= 2
      ) {
        const connectionId = request.path[1]!;
        const broker = new CoreBrokerClient(this.ctx.connections);
        if (request.path.length === 2)
          return Response.json(await broker.describe(connectionId));
        if (request.path.length === 3 && request.path[2] === "permissions")
          return Response.json(await broker.permissions(connectionId));
      }
      if (method === "POST" && route === "check-access") {
        const parsed = accessSchema.safeParse(body(request));
        if (!parsed.success) throw new LarkError("invalid_parameters");
        return Response.json(
          await this.ctx.runAction("lark:check_access", parsed.data),
        );
      }
      if (method === "GET" && route === "status") {
        if (!this.cache || Date.now() - this.cache.at > 10000) {
          this.cache = { at: Date.now(), value: await this.service.status() };
        }
        return Response.json({
          appId: "lark",
          version: this.ctx.app.version,
          ...(this.cache.value as object),
          preferences: this.service.repo.preferences(),
          job: publicJob(this.service.repo),
          scopeGroups: AUTH_SCOPE_GROUPS,
        });
      }
      if (method === "GET" && route === "commands")
        return Response.json({ items: COMMANDS });
      if (
        method === "GET" &&
        request.path[0] === "commands" &&
        request.path.length === 2
      ) {
        return Response.json(commandDetails(request.path[1]!));
      }
      if (method === "GET" && route === "activity")
        return Response.json({ items: this.service.repo.activity() });
      if (method === "PUT" && route === "preferences") {
        const value = body(request);
        if (
          Object.keys(value).some(
            (k) => !["agentEnabled", "writesEnabled"].includes(k),
          ) ||
          Object.values(value).some((v) => typeof v !== "boolean")
        )
          throw new LarkError("invalid_preferences");
        return Response.json(this.service.repo.updatePreferences(value));
      }
      if (method === "POST" && route === "setup") {
        const value = body(request);
        if (
          !["existing", "new", "auth"].includes(String(value.kind)) ||
          !["feishu", "lark"].includes(String(value.brand)) ||
          !["zh", "en"].includes(String(value.locale))
        )
          throw new LarkError("invalid_setup");
        if (
          value.kind === "existing" &&
          (typeof value.appId !== "string" ||
            typeof value.appSecret !== "string")
        )
          throw new LarkError("invalid_app_credentials");
        if (
          value.kind === "auth" &&
          (!Array.isArray(value.groups) ||
            value.groups.some((v) => typeof v !== "string"))
        )
          throw new LarkError("invalid_scope_groups");
        const job = startSetup(this.service.repo, {
          kind: value.kind as "existing" | "new" | "auth",
          brand: value.brand as "feishu" | "lark",
          locale: value.locale as "zh" | "en",
          appId: value.appId as string | undefined,
          appSecret: value.appSecret as string | undefined,
          groups: value.groups as string[] | undefined,
        });
        this.cache = undefined;
        return Response.json(job, { status: 202 });
      }
      if (method === "POST" && route === "setup/cancel") {
        const value = body(request);
        if (typeof value.id !== "string") throw new LarkError("invalid_setup");
        cancelSetup(this.service.repo, value.id);
        return Response.json({ ok: true });
      }
      if (method === "POST" && route === "preview") {
        return Response.json(
          await this.ctx.runAction("lark:preview", body(request)),
        );
      }
      if (method === "POST" && route === "invoke") {
        const value = body(request);
        const spec = findCommand(String(value.command));
        if (
          spec.risk === "write" &&
          value.requestId === undefined &&
          (value.connectionId === undefined ||
            value.connectionId === LOCAL_CONNECTION_ID)
        ) {
          // Preserve the legacy reservation for independent CLI submissions.
          const params = Object.entries(value.parameters ?? {}).sort(
            ([a], [b]) => a.localeCompare(b),
          );
          value.requestId = createHash("sha256")
            .update(
              JSON.stringify([
                LOCAL_CONNECTION_ID,
                value.identity,
                spec.id,
                value.connectionRevision,
                params,
              ]),
            )
            .digest("hex");
        }
        const parsed = (
          spec.risk === "write" ? writeSchema : invocationSchema
        ).safeParse(value);
        if (!parsed.success) throw new LarkError("invalid_parameters");
        const requestId =
          "requestId" in parsed.data ? parsed.data.requestId : undefined;
        const { command, identity, parameters, connectionId } = parsed.data;
        const isCore =
          connectionId !== undefined && connectionId !== LOCAL_CONNECTION_ID;
        if (isCore) {
          coreInput(
            prepareInvocation(command, identity, parameters, spec.risk, true),
          );
          await resolveConnection(
            parsed.data,
            spec.risk,
            new CoreBrokerClient(this.ctx.connections),
          );
        }
        const name =
          spec.risk === "read"
            ? "lark:read"
            : isCore
              ? "lark:core_write"
              : "lark:write";
        const result = await this.ctx.runAction(name, parsed.data);
        if (result.status === "pending_approval")
          return Response.json(
            {
              ...result,
              approvalId: result.approval.approvalId,
              requestId,
            },
            { status: 202 },
          );
        if (name === "lark:core_write" && result.status === "ok") {
          const write = result.data as Awaited<
            ReturnType<CoreBrokerClient["execute"]>
          >;
          return Response.json(
            {
              ...result,
              status: write.status ?? "ok",
              requestId: write.requestId,
              ...("executionId" in write && { executionId: write.executionId }),
              ...("approval" in write && {
                approvalId: write.approvalId,
                approval: write.approval,
              }),
            },
            { status: write.status === "pending_approval" ? 202 : 200 },
          );
        }
        return Response.json(
          spec.risk === "write" ? { ...result, requestId } : result,
        );
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      const failure = safeFailure(error);
      return Response.json(
        {
          error: failure.code,
          detail: failure.detail,
          message: actionErrorMessage(error),
        },
        { status: failure.code === "internal_error" ? 500 : 400 },
      );
    }
  }
}
export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new LarkApi(ctx);
}
