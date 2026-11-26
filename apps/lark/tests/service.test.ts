import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { z } from "@rome-os/app-runtime";
import { LarkService, type Runner } from "../src/lib/service.js";
import { LarkError } from "../src/lib/policy.js";
import { startSetup, publicJob } from "../src/lib/setup.js";
import { testContext, guardian } from "./helpers.js";
import { createAction as createLocalWrite } from "../src/actions/write/index.js";
import { createAction as createApprovedWrite } from "../src/actions/approve-local-write/index.js";
const write = {
  command: "docs.create",
  identity: "user" as const,
  parameters: { title: "Test", content: "synthetic document" },
  requestId: "request_fixture_01",
  connectionRevision: 0,
};
const success: Runner = async () => ({
  exitCode: 0,
  stdout: '{"ok":true,"data":{"document_id":"fixture"}}',
  stderr: "",
});

test("write transport mismatches are rejected before approval or execution", async () => {
  const { ctx, native } = testContext();
  try {
    const coreWrite = {
      ...write,
      connectionId: "bot-A",
      identity: "bot" as const,
    };
    const action = createLocalWrite(
      { name: "write" } as never,
      { appContext: ctx } as never,
    );
    const approval = {
      status: "pending_approval" as const,
      approval: { approvalId: "approval-fixture", actionName: "lark:approve_local_write", description: "Approve local write" },
    };
    const runAction = vi.spyOn(ctx, "runAction").mockResolvedValue(approval as never);
    const schema = z.fromJSONSchema(action.inputSchema!);
    const approver = createApprovedWrite(
      { name: "approve_local_write", requiresApproval: true } as never,
      { appContext: ctx } as never,
    );
    for (const connectionId of ["bot-A", "core:fixture", "conn_fixture"]) {
      const invalid = { ...coreWrite, connectionId };
      assert.equal(schema.safeParse(invalid).success, false);
      const result = await action.execute(invalid);
      assert.equal(result.status, "error");
      assert.match(result.error, /core_write_required.*lark:core_write/);
      await assert.rejects(
        async () => action.preview!(invalid),
        /core_write_required.*lark:core_write/,
      );
      const approved = await approver.execute(invalid);
      assert.equal(approved.status, "error");
      assert.match(approved.error, /core_write_required/);
    }
    assert.equal(runAction.mock.calls.length, 0);

    for (const valid of [write, { ...write, connectionId: "local-cli" }]) {
      assert.equal(schema.safeParse(valid).success, true);
      const preview = await action.preview!(valid);
      assert.equal(preview?.kind, "generic");
      assert.match(preview.title, /^Lark · /);
      assert.deepEqual(await approver.preview!(valid), preview);
      assert.deepEqual(await action.execute(valid), approval);
      assert.deepEqual(runAction.mock.lastCall, ["lark:approve_local_write", valid]);
    }
    assert.equal(runAction.mock.calls.length, 2);

    const service = new LarkService(ctx, async () => {
      throw new Error("CLI must not run");
    });
    await assert.rejects(
      service.invoke(coreWrite, "write", guardian),
      /core_write_required/,
    );
    await assert.rejects(
      service.invoke({ ...coreWrite, connectionId: "local-cli" }, "core_write", guardian),
      /local_write_required/,
    );
    assert.deepEqual(service.repo.activity(), []);
  } finally {
    native.close();
  }
});
test("write reservation prevents replay and parameter/account substitution", async () => {
  const { ctx, native } = testContext();
  let calls = 0;
  const service = new LarkService(ctx, async (...args) => {
    calls++;
    return success(...args);
  });
  const first = await service.invoke(write, "write", guardian);
  assert.equal(first.ok, true);
  const second = await service.invoke(write, "write", guardian);
  assert.equal(second.ok, true);
  assert("alreadyCompleted" in second);
  assert.equal(calls, 1);
  await assert.rejects(
    service.invoke(
      { ...write, parameters: { ...write.parameters, title: "Changed" } },
      "write",
      guardian,
    ),
    /request_id_conflict/,
  );
  service.repo.updatePreferences({ revision: 1 });
  await assert.rejects(
    service.invoke(write, "write", guardian),
    /connection_changed/,
  );
  const text = JSON.stringify(
    native.prepare("select * from lark__invocations").all(),
  );
  assert(!text.includes("synthetic document"));
  assert(!text.includes('"title"'));
  native.close();
});
test("uncertain writes stay blocked and are not retried", async () => {
  const { ctx, native } = testContext();
  let calls = 0;
  const service = new LarkService(ctx, async () => {
    calls++;
    throw new LarkError("timeout", "", true);
  });
  const value = await service.invoke(write, "write", guardian);
  assert.equal(value.ok, false);
  assert("outcomeUnknown" in value && value.outcomeUnknown);
  await assert.rejects(
    service.invoke(write, "write", guardian),
    /outcome_unknown/,
  );
  assert.equal(calls, 1);
  assert.equal(service.repo.activity()[0]?.state, "unknown");
  native.close();
});
test("group/non-guardian calls cannot reach CLI, even through app context", async () => {
  const { ctx, native } = testContext();
  let calls = 0;
  const service = new LarkService(ctx, async () => {
    calls++;
    return success([]);
  });
  for (const context of [
    {
      channelContext: {
        ...guardian.channelContext,
        threadType: "group" as const,
      },
    },
    {
      callerAppId: "lark",
      channelContext: { ...guardian.channelContext, senderBondLevel: "other" },
    },
  ])
    await assert.rejects(
      service.invoke(
        { command: "calendar.agenda", identity: "user", parameters: {} },
        "read",
        context,
      ),
    );
  assert.equal(calls, 0);
  native.close();
});
test("disable toggles and setup locks apply before execution", async () => {
  const { ctx, native } = testContext();
  const service = new LarkService(ctx, success);
  service.repo.updatePreferences({ writesEnabled: false });
  await assert.rejects(
    service.invoke(write, "write", guardian),
    /writes_disabled/,
  );
  service.repo.updatePreferences({ writesEnabled: true, agentEnabled: false });
  await assert.rejects(
    service.invoke(write, "write", guardian),
    /agent_access_disabled/,
  );
  service.repo.updatePreferences({ agentEnabled: true });
  service.repo.beginJob("fixture-job", "auth");
  await assert.rejects(
    service.invoke(
      { ...write, connectionRevision: service.repo.preferences().revision },
      "write",
      guardian,
    ),
    /setup_in_progress/,
  );
  native.close();
});
test("restart recovery distinguishes unknown writes from failed reads", () => {
  const { ctx, native } = testContext();
  const service = new LarkService(ctx, success);
  for (const risk of ["write", "read"]) {
    service.repo.reserve({
      id: risk,
      fingerprint: risk,
      command: "fixture",
      identity: "user",
      risk,
      state: "running",
      createdAt: new Date().toISOString(),
    });
  }
  service.repo.recoverInterrupted();
  assert.equal(
    service.repo.activity().find((r) => r.id === "write")?.state,
    "unknown",
  );
  assert.equal(
    service.repo.activity().find((r) => r.id === "read")?.state,
    "failed",
  );
  native.close();
});
test("status projects only safe identity fields; no token material", async () => {
  const { ctx, native } = testContext();
  const service = new LarkService(ctx, async () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      appId: "cli_fixture",
      brand: "feishu",
      access_token: "SYNTHETIC",
      identities: {
        user: { available: true, status: "ready", access_token: "SYNTHETIC" },
        bot: { available: true, status: "ready" },
      },
    }),
    stderr: "",
  }));
  const value = await service.status();
  assert.equal(value.identities.user.available, true);
  assert(!JSON.stringify(value).includes("SYNTHETIC"));
  native.close();
});
test("setup completion accepts streaming JSON without persisting challenges", async () => {
  const { ctx, native } = testContext();
  const service = new LarkService(ctx, success);
  const fake = async (
    _args: string[],
    options?: { onChunk?: (text: string) => void },
  ) => {
    options?.onChunk?.(
      '{"verification_uri_complete":"https://open.feishu.cn/page/cli?user_code=synthetic"}\n',
    );
    return {
      exitCode: 0,
      stdout: '{"event":"device_authorization"}\n{\n "ok":true\n}',
      stderr: "",
    };
  };
  const job = startSetup(
    service.repo,
    { kind: "auth", brand: "feishu", locale: "zh", groups: ["docs"] },
    fake,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(service.repo.job(job.id)?.state, "completed");
  assert.equal(publicJob(service.repo)?.verificationUrl, undefined);
  const text = JSON.stringify(
    native.prepare("select * from lark__setup_jobs").all(),
  );
  assert(!text.includes("synthetic"));
  native.close();
});
