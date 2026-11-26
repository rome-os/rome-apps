import { createHash, randomUUID } from "node:crypto";
import {
  getCurrentActionContext,
  type RomeAppContext,
  type CurrentActionContext,
} from "@rome-os/app-runtime";
import { CLI_VERSION, type Identity } from "../shared/catalog.js";
import { LOCAL_CONNECTION_ID } from "../shared/managed-connections.js";
import { requestIdSchema } from "../actions/input.js";
import { resolveConnection } from "./connection-policy.js";
import { CoreBrokerClient } from "./core-broker.js";
import { coreInput } from "./core-commands.js";

import { createRepository } from "../db/repositories/lark.js";
import {
  assertGuardian,
  LarkError,
  prepareInvocation,
  safeFailure,
} from "./policy.js";
import {
  runCli,
  parseOutput,
  type RunnerOptions,
  type RunnerResult,
} from "./runner.js";
export type Runner = (
  args: string[],
  options?: RunnerOptions,
) => Promise<RunnerResult>;
export class LarkService {
  readonly repo;
  constructor(
    private ctx: RomeAppContext,
    private runner: Runner = runCli,
    private broker = new CoreBrokerClient(ctx.connections),
  ) {
    this.repo = createRepository(ctx.db);
  }
  async status() {
    const result = await this.runner(["auth", "status", "--json"], {
      timeoutMs: 12000,
      maxBytes: 128000,
    }).catch((error: unknown) => {
      if (!(error instanceof LarkError) || error.code !== "cli_unavailable")
        throw error;
      return {
        exitCode: 1,
        stdout: "",
        stderr: '{"error":{"type":"cli","subtype":"unavailable"}}',
      };
    });
    const base = {
      cliVersion: CLI_VERSION,
      preferences: this.repo.preferences(),
      setupUrl: "/apps/lark",
      accessPolicy: "guardian_private_only",
      botTransport: "rome",
      eventListener: false,
      executionConnectionId: "local-cli",
      managedExecution: "query_status_with_connectionId",
    };
    if (result.exitCode !== 0) {
      let code = "not_configured";
      try {
        parseOutput(result);
      } catch (e) {
        code = safeFailure(e).code;
      }
      return {
        ...base,
        configured: false,
        identities: {
          user: { available: false, status: code },
          bot: { available: false, status: code },
        },
      };
    }
    const raw = parseOutput(result) as Record<string, unknown>;
    const identities = raw.identities as
      Record<string, Record<string, unknown>> | undefined;
    function identity(name: string) {
      const item = identities?.[name];
      return {
        available: item?.available === true,
        status: typeof item?.status === "string" ? item.status : "unavailable",
        verified:
          typeof item?.verified === "boolean" ? item.verified : undefined,
      };
    }
    return {
      ...base,
      configured: true,
      appId: typeof raw.appId === "string" ? raw.appId : undefined,
      brand: raw.brand === "lark" ? "lark" : "feishu",
      identities: { user: identity("user"), bot: identity("bot") },
    };
  }
  async invoke(
    input: {
      command: string;
      connectionId?: string;
      authorizationRevision?: string;
      identity: Identity;
      parameters: Record<string, unknown>;
      requestId?: string;
      connectionRevision?: number;
    },
    action: "read" | "write" | "core_write",
    context: CurrentActionContext | undefined = getCurrentActionContext(),
  ) {
    const risk = action === "read" ? "read" : "write";
    assertGuardian(context, risk === "write");

    const isLocal =
      input.connectionId === undefined || input.connectionId === LOCAL_CONNECTION_ID;
    if (action === "write" && !isLocal)
      throw new LarkError("core_write_required");
    if (action === "core_write" && isLocal)
      throw new LarkError("local_write_required");

    let requestId: string | undefined;
    if (risk === "write") {
      const parsed = requestIdSchema.safeParse(input.requestId);
      if (!parsed.success) throw new LarkError("request_id_required");
      requestId = parsed.data;
    }

    const prefs = this.repo.preferences();
    if (!prefs.agentEnabled) throw new LarkError("agent_access_disabled");
    if (risk === "write" && !prefs.writesEnabled)
      throw new LarkError("writes_disabled");
    if (risk === "write" && input.connectionRevision !== prefs.revision)
      throw new LarkError("connection_changed_refresh_status");
    const invocation = prepareInvocation(
      input.command,
      input.identity,
      input.parameters,
      risk,
      !isLocal,
    );
    const brokerInput = isLocal ? undefined : coreInput(invocation);
    const connection = await resolveConnection(input, risk, this.broker);
    const connectionId = connection?.connectionId ?? LOCAL_CONNECTION_ID;
    if (connection)
      return this.broker.execute(
        connectionId,
        invocation,
        requestId,
        brokerInput,
      );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          connectionId,
          authorizationRevision: null,
          command: input.command,
          identity: input.identity,
          parameters: invocation.parameters,
          revision: prefs.revision,
        }),
      )
      .digest("hex");
    const id = requestId ? `w_${requestId}` : `r_${randomUUID()}`;
    const previous = this.repo.reserve(
      {
        id,
        fingerprint,
        connectionId,
        authorizationRevision: null,
        command: input.command,
        identity: input.identity,
        risk,
        state: "running",
        executionId: context?.executionId ?? null,
        createdAt: new Date().toISOString(),
      },
      prefs.revision,
    );
    if (previous) {
      if (previous.state === "completed")
        return {
          ok: true,
          alreadyCompleted: true,
          requestId,
          activityId: id,
          message: "Already completed. No second request was sent.",
        };
      throw new LarkError(
        previous.state === "running"
          ? "request_in_progress"
          : "outcome_unknown_do_not_retry",
      );
    }
    if (input.command === "im.send_as_user" && requestId) {
      const key = /^[a-zA-Z0-9_-]{8,50}$/.test(requestId)
        ? requestId
        : createHash("sha256").update(requestId).digest("hex").slice(0, 50);
      invocation.argv.push(`--idempotency-key=${key}`);
    }
    try {
      const result = parseOutput(
        await this.runner(invocation.argv, {
          stdin: invocation.stdin,
          timeoutMs: 45000,
        }),
      );
      this.repo.finish(id, "completed");
      return {
        ok: true,
        activityId: id,
        connectionId,
        identity: input.identity,
        data: result,
      };
    } catch (error) {
      const failure = safeFailure(error);
      const uncertain = risk === "write";
      this.repo.finish(id, uncertain ? "unknown" : "failed", failure.code);
      return {
        ok: false,
        activityId: id,
        error: failure.code,
        detail: failure.detail,
        outcomeUnknown: uncertain,
        retryAllowed: !uncertain,
        instruction: uncertain
          ? "Do not retry automatically. Inspect the target in Lark first."
          : "Resolve the error before retrying.",
      };
    }
  }
}
