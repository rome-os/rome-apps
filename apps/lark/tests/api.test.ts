import { expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  setCurrentActionContextResolver,
  type RomeAppApiRequest,
} from "@rome-os/app-runtime";
import { createApiHandler } from "../src/api/index.js";
import { createAction as createPreview } from "../src/actions/preview/index.js";
import { LarkService } from "../src/lib/service.js";
import { guardian, testContext } from "./helpers.js";
function request(
  path: string,
  options: Partial<RomeAppApiRequest> = {},
): RomeAppApiRequest {
  return {
    path: path.split("/"),
    method: "GET",
    query: new URLSearchParams(),
    headers: { "x-lark-ui": "1" },
    caller: { kind: "guardian", userId: "fixture", via: "loopback" },
    ...options,
  };
}
test("owner-only API stays closed to visitors, anonymous and missing CSRF headers", async () => {
  const { ctx, native } = testContext();
  const api = createApiHandler(ctx);
  for (const caller of [
    { kind: "anonymous" as const },
    {
      kind: "visitor" as const,
      accountId: "fixture",
      email: "fixture@example.test",
    },
  ])
    assert.equal(
      (await api.handle(request("commands", { caller }))).status,
      403,
    );
  assert.equal(
    (
      await api.handle(
        request("preferences", {
          method: "PUT",
          headers: {},
          body: new TextEncoder().encode("{}"),
        }),
      )
    ).status,
    403,
  );
  assert.equal((await api.handle(request("commands"))).status, 200);
  native.close();
});
test("write API dispatches the approved action, never directly to CLI", async () => {
  const { ctx, native } = testContext();
  const captured: Array<{ name: string; args: unknown }> = [];
  ctx.runAction = async (name, args) => {
    captured.push({ name, args });
    return {
      status: "pending_approval",
      approval: { approvalId: "fixture-approval" },
    } as never;
  };
  const api = createApiHandler(ctx);
  const value = {
    command: "docs.create",
    identity: "user",
    parameters: { title: "Fixture", content: "Fixture only" },
    requestId: "fixture-request-1",
    connectionRevision: 0,
  };
  const response = await api.handle(
    request("invoke", {
      method: "POST",
      body: new TextEncoder().encode(JSON.stringify(value)),
    }),
  );
  assert.equal(response.status, 202);
  assert.equal(captured[0]?.name, "lark:write");
  assert.deepEqual(captured[0]?.args, value);
  assert.deepEqual(await response.json(), {
    status: "pending_approval",
    approval: { approvalId: "fixture-approval" },
    approvalId: "fixture-approval",
    requestId: value.requestId,
  });
  assert.equal(
    native.prepare("select count(*) as n from lark__invocations").get()?.n,
    0,
  );
  const legacyIds: string[] = [];
  for (const connectionId of [undefined, "local-cli"]) {
    const legacy = await api.handle(
      request("invoke", {
        method: "POST",
        body: new TextEncoder().encode(
          JSON.stringify({ ...value, connectionId, requestId: undefined }),
        ),
      }),
    );
    assert.equal(legacy.status, 202);
    const { requestId } = await legacy.json();
    assert.match(requestId, /^[a-f0-9]{64}$/);
    legacyIds.push(requestId);
  }
  assert.equal(captured[1]?.name, "lark:write");
  assert.equal(captured[2]?.name, "lark:write");
  assert.equal(legacyIds[0], legacyIds[1]);
  native.close();
});
test("API input validation rejects invalid jobs, raw operations and nonboolean preferences", async () => {
  const { ctx, native } = testContext();
  const api = createApiHandler(ctx);
  for (const [route, payload] of [
    ["setup", { kind: "auth", brand: "feishu", locale: "zh", groups: ["all"] }],
    ["invoke", { command: "api" }],
    ["preferences", { agentEnabled: "true" }],
  ]) {
    const response = await api.handle(
      request(String(route), {
        method: route === "preferences" ? "PUT" : "POST",
        body: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    assert.equal(response.status, 400);
  }
  native.close();
});

test.each([
  [{ "page-token": "cursor", start: "2026-11-26T10:00:00+08:00" }, "invalid_input"],
  [{ "page-token": "cursor", end: "2026-11-26T11:00:00+08:00" }, "invalid_input"],
  [{ "page-size": 49 }, "invalid_parameter"],
  [{ start: "yesterday" }, "invalid_parameter"],
  [{ start: "100", end: "9" }, "invalid_time_range"],
  [
    { start: "2026-11-26T12:00:00+08:00", end: "2026-11-26T11:00:00+08:00" },
    "invalid_time_range",
  ],
])(
  "rejects invalid Core agenda parameters %j before connection discovery",
  async (parameters, code) => {
    const { ctx, native } = testContext();
    const unavailable = async () => {
      throw new Error("Core is unavailable");
    };
    const describe = vi.fn(unavailable);
    const operations = vi.fn(unavailable);
    const invoke = vi.fn(unavailable);
    ctx.connections = { describe, operations, invoke, list: vi.fn(unavailable) };
    const runAction = vi.fn(unavailable);
    ctx.runAction = runAction;
    const input = {
      connectionId: "core-one",
      command: "calendar.agenda",
      identity: "bot" as const,
      parameters,
    };
    setCurrentActionContextResolver(() => guardian);
    try {
      await expect(
        new LarkService(ctx).invoke(input, "read", guardian),
      ).rejects.toMatchObject({ code });
      const preview = createPreview({ name: "preview" } as never, {
        appContext: ctx,
      });
      await expect(preview.execute(input)).resolves.toEqual({
        status: "error",
        error: code,
      });
      const response = await createApiHandler(ctx).handle(
        request("invoke", {
          method: "POST",
          body: new TextEncoder().encode(JSON.stringify(input)),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: code });
      expect(runAction).not.toHaveBeenCalled();
      expect(describe).not.toHaveBeenCalled();
      expect(operations).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      setCurrentActionContextResolver(() => undefined);
      native.close();
    }
  },
);

test("unavailable Core-selected write is rejected before the API can request approval", async () => {
  const { ctx, native } = testContext();
  let calls = 0;
  ctx.runAction = async () => {
    calls++;
    throw new Error("must not dispatch");
  };
  const response = await createApiHandler(ctx).handle(
    request("invoke", {
      method: "POST",
      body: new TextEncoder().encode(
        JSON.stringify({
          connectionId: "core-one",
          command: "docs.create",
          identity: "bot",
          parameters: { title: "Fixture", content: "Fixture only" },
          requestId: "fixture-core-01",
          connectionRevision: 0,
        }),
      ),
    }),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /^core_gateway_unavailable$/);
  assert.equal(calls, 0);
  native.close();
});

test("guardian HTTP Core writes require caller IDs and preserve pending and duplicate receipts", async () => {
  const { createAction } = await import("../src/actions/core-write/index.js");
  const { setCurrentActionContextResolver } =
    await import("@rome-os/app-runtime");
  const { ctx, native } = testContext();
  const submissions: Array<Record<string, unknown>> = [];
  const runs: string[] = [];
  const executions = new Map<unknown, string>();
  const approval = {
    approvalId: "A",
    actionName: "test:write",
    description: "Fixture approval",
  };
  ctx.connections = {
    describe: async () => ({
      connection: {
        connectionId: "bot-A",
        connectionKind: "feishu",
        label: "A",
      },
      identity: { name: "app" },
      act: { state: "available" },
    }),
    operations: async () => ({
      operations: [
        {
          name: "feishu.document.create",
          approval: "required",
          sideEffects: "write",
          access: "granted",
        },
      ],
    }),
    invoke: async (args: Record<string, unknown>) => {
      submissions.push(args);
      const previous = executions.get(args.requestId);
      if (previous)
        return {
          status: "duplicate",
          executionId: previous,
          outcome: "succeeded",
        };
      const executionId = `E${executions.size + 1}`;
      executions.set(args.requestId, executionId);
      return {
        status: "pending_approval",
        executionId,
        approval,
      };
    },
  } as unknown as typeof ctx.connections;
  const action = createAction(
    { name: "core_write" } as never,
    { appContext: ctx } as never,
  );
  ctx.runAction = (async (name: string, params: Record<string, unknown>) => {
    runs.push(name);
    return action.execute(params);
  }) as typeof ctx.runAction;
  const api = createApiHandler(ctx);
  setCurrentActionContextResolver(() => ({ callerAppId: "lark" }));
  const send = (requestId?: string, command = "docs.create") =>
    api.handle(
      request("invoke", {
        method: "POST",
        body: new TextEncoder().encode(
          JSON.stringify({
            connectionId: "bot-A",
            identity: "bot",
            command,
            parameters: { title: "T", content: "C" },
            connectionRevision: 0,
            requestId,
          }),
        ),
      }),
    );
  try {
    for (const command of ["docs.create", "docs.update", "calendar.create"]) {
      const response = await send(undefined, command);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid_parameters");
    }
    for (const invalid of ["  1234567  ", "x".repeat(201)]) {
      const response = await send(invalid);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid_parameters");
    }
    assert.equal(runs.length, 0);
    assert.equal(submissions.length, 0);

    const ids = ["lark:write:123456", "lark.write.123456"];
    for (const [index, requestId] of ids.entries()) {
      const response = await send(` ${requestId} `);
      assert.equal(response.status, 202);
      const receipt = await response.json();
      const expected = {
        status: "pending_approval",
        approval,
        approvalId: approval.approvalId,
        executionId: `E${index + 1}`,
        requestId,
      };
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(receipt[key], value);
        assert.deepEqual(receipt.data[key], value);
      }
    }
    const duplicate = await send(ids[0]);
    assert.equal(duplicate.status, 200);
    const receipt = await duplicate.json();
    assert.equal(receipt.status, "duplicate");
    assert.equal(receipt.executionId, "E1");
    assert.equal(receipt.requestId, ids[0]);
    assert.equal(receipt.data.outcome, "succeeded");
    assert.deepEqual(runs, Array(3).fill("lark:core_write"));
    assert.deepEqual(submissions.map((entry) => entry.requestId), [
      ...ids,
      ids[0],
    ]);
    assert.deepEqual(submissions[0]?.input, submissions[1]?.input);
    assert.equal(executions.size, 2);
    assert(
      submissions.every(
        (r) => r.operation === "feishu.document.create" && r.identity === "app",
      ),
    );
    const input = {
      connectionId: "local-cli",
      identity: "bot",
      command: "docs.create",
      parameters: { title: "T" },
      connectionRevision: 0,
      requestId: "caller-12345",
    };
    const attempt = await action.execute(input);
    assert.equal(attempt.status, "error");
    assert.match(attempt.error, /local_write_required.*lark:write/);
    const missingId = await action.execute({
      ...input,
      connectionId: "bot-A",
      requestId: undefined,
    });
    assert.equal(missingId.status, "error");
    assert.match(missingId.error, /requestId/);
    assert.equal(submissions.length, 3);
  } finally {
    setCurrentActionContextResolver(null);
    native.close();
  }
});
