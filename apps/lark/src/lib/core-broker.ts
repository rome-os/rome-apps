import { type AppConnectionsCapability, z } from "@rome-os/app-runtime";
import { SCOPE_OPERATION } from "../shared/catalog.js";
import type { CoreConnection } from "../shared/core-access.js";
import { LarkError, type Invocation } from "./policy.js";
import { coreInput, coreOutput } from "./core-commands.js";

export type { CoreConnection } from "../shared/core-access.js";
const MAX_OPERATION_PAGES = 20;
const scopeData = z.object({
  scopes: z.array(
    z.object({
      scopeName: z.string(),
      grantStatus: z.number().int(),
      scopeType: z.string().optional(),
    }),
  ),
  checkedAt: z.string(),
});
export type ScopeSnapshot =
  | ({ connectionId: string; status: "checked" } & z.infer<typeof scopeData>)
  | {
      connectionId: string;
      status: "unauthorized" | "query_failed";
      error: string;
    };

function rethrow(error: unknown): never {
  const parsed = z
    .object({
      detail: z.object({
        code: z.enum([
          "access_denied",
          "connection_not_found",
          "identity_not_found",
          "operation_not_found",
          "capability_unavailable",
          "authorization_required",
          "connection_unhealthy",
          "invalid_input",
          "resource_denied",
          "resource_unresolved",
          "request_id_required",
          "request_id_conflict",
          "request_in_progress",
          "rate_limited",
          "approval_rejected",
          "outcome_unknown",
          "provider_error",
        ]),
        message: z.string(),
        reason: z.string().optional(),
        retryable: z.boolean(),
      }),
    })
    .safeParse(error);
  if (parsed.success) {
    const detail = parsed.data.detail;
    const reasons = new Set([
      "provider_scope_required",
      "provider_resource_denied",
      "provider_not_found",
      "provider_response_too_large",
      "provider_response_invalid",
      "provider_unavailable",
    ]);
    throw new LarkError(
      detail.code === "provider_error" &&
        detail.reason &&
        reasons.has(detail.reason)
        ? detail.reason
        : detail.code,
    );
  }
  if (error instanceof LarkError) throw error;
  throw new LarkError("core_gateway_unavailable");
}
export class CoreBrokerClient {
  constructor(private readonly connections?: AppConnectionsCapability) {}
  private gateway(): AppConnectionsCapability {
    if (!this.connections) throw new LarkError("core_gateway_unavailable");
    return this.connections;
  }
  async list(cursor?: string) {
    try {
      return await this.gateway().list({
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      return rethrow(error);
    }
  }
  async describe(connectionId: string): Promise<CoreConnection> {
    try {
      const descriptor = await this.gateway().describe({
        connectionId,
        identity: "app",
      });
      if (
        descriptor.connection.connectionKind !== "feishu" ||
        descriptor.connection.connectionId !== connectionId ||
        descriptor.identity.name !== "app"
      )
        throw new LarkError("connection_unavailable");
      const operations: CoreConnection["operations"] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await this.gateway().operations({
          connectionId,
          identity: "app",
          limit: 50,
          ...(cursor && { cursor }),
        });
        operations.push(...page.operations);
        cursor = page.nextCursor;
        if (
          cursor &&
          (seen.has(cursor) || seen.size + 1 >= MAX_OPERATION_PAGES)
        )
          throw new LarkError("incomplete_operation_list");
        if (cursor) seen.add(cursor);
      } while (cursor);
      const grantedOperations = operations
        .filter((op) => op.access === "granted")
        .map((op) => op.name);
      return {
        connectionId,
        label: descriptor.connection.label,
        act: descriptor.act,
        identities: {
          bot: {
            available:
              descriptor.act.state === "available" &&
              grantedOperations.length > 0,
          },
          user: { available: false },
        },
        operations,
        grantedOperations,
      };
    } catch (error) {
      return rethrow(error);
    }
  }

  private async invoke(
    connectionId: string,
    operation: string,
    input: Record<string, unknown>,
    requestId?: string,
  ) {
    try {
      return await this.gateway().invoke({
        connectionId,
        identity: "app",
        operation,
        input,
        ...(requestId && { requestId }),
      });
    } catch (error) {
      return rethrow(error);
    }
  }

  async execute(
    connectionId: string,
    call: Invocation,
    requestId?: string,
    brokerInput?: Record<string, unknown>,
  ) {
    const operation = call.spec.coreOperation;
    if (!operation) throw new LarkError("core_user_identity_unsupported");
    if (call.spec.risk === "write" && !requestId)
      throw new LarkError("request_id_required");
    const input = brokerInput ?? coreInput(call);
    const base = {
      connectionId,
      identity: "bot",
      ...(requestId && { requestId }),
    };
    let executionId: string | undefined;
    try {
      const result = await this.invoke(
        connectionId,
        operation,
        input,
        requestId,
      );
      if (
        !result ||
        typeof result.executionId !== "string" ||
        !result.executionId
      )
        throw new LarkError("invalid_core_response");
      executionId = result.executionId;
      if (result.status === "ok")
        return {
          ...base,
          ok: true,
          ...(requestId && { status: "ok" as const }),
          executionId,
          data: coreOutput(call, input, result.data),
        };
      if (!requestId) throw new LarkError("unexpected_core_read_result");
      const common = {
        ...base,
        status: result.status,
        executionId,
        retryAllowed: false,
      };
      switch (result.status) {
        case "pending_approval":
          if (
            typeof result.approval?.approvalId !== "string" ||
            !result.approval.approvalId
          )
            throw new LarkError("invalid_core_response");
          return {
            ...common,
            ok: false,
            approvalId: result.approval.approvalId,
            approval: result.approval,
            instruction:
              "Review the pending request in Rome Activity. Do not resubmit.",
          };
        case "duplicate":
          if (result.outcome !== "succeeded" && result.outcome !== "failed")
            throw new LarkError("invalid_core_response");
          return {
            ...common,
            ok: result.outcome === "succeeded",
            outcome: result.outcome,
            error: result.errorCode,
            instruction:
              "This ID was already processed. No second write was sent.",
          };
        case "outcome_unknown":
          throw new LarkError("outcome_unknown");
        default:
          throw new LarkError("invalid_core_response");
      }
    } catch (error) {
      if (!requestId || !(error instanceof LarkError)) throw error;
      if (error.code === "request_in_progress")
        return {
          ...base,
          ok: false,
          status: error.code,
          retryAllowed: false,
          instruction:
            "The request is in progress. Do not retry with a new ID.",
        };
      if (
        [
          "outcome_unknown",
          "core_gateway_unavailable",
          "invalid_core_response",
        ].includes(error.code)
      )
        return {
          ...base,
          ok: false,
          status: "outcome_unknown",
          executionId,
          outcomeUnknown: true,
          retryAllowed: false,
          instruction:
            "The write may have taken effect. Inspect the target in Lark before taking further action. Do not retry automatically.",
        };
      throw error;
    }
  }

  async permissions(connectionId: string): Promise<ScopeSnapshot> {
    try {
      const result = await this.invoke(connectionId, SCOPE_OPERATION, {});
      if (result.status !== "ok")
        throw new LarkError("unexpected_core_read_result");
      const parsed = scopeData.safeParse(result.data);
      if (!parsed.success) throw new LarkError("invalid_core_response");
      const { checkedAt, scopes } = parsed.data;
      return {
        connectionId,
        status: "checked",
        checkedAt,
        scopes: scopes.filter(
          ({ scopeType }) =>
            scopeType === undefined || scopeType.toLowerCase() === "tenant",
        ),
      };
    } catch (error) {
      const code =
        error instanceof LarkError ? error.code : "invalid_core_response";
      const denied = [
        "access_denied",
        "authorization_required",
        "provider_scope_required",
        "provider_resource_denied",
        "resource_denied",
      ].includes(code);
      return {
        connectionId,
        status: denied ? "unauthorized" : "query_failed",
        error: code,
      };
    }
  }
}
