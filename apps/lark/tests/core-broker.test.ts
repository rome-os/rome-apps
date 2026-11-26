import assert from "node:assert/strict";
import { test } from "vitest";
import type { AppConnectionsCapability } from "@rome-os/app-runtime";
import { documentIdOf } from "../src/lib/core-commands.js";
import { prepareInvocation } from "../src/lib/policy.js";
import { CoreBrokerClient } from "../src/lib/core-broker.js";
import { LarkService } from "../src/lib/service.js";
import { guardian, testContext } from "./helpers.js";

function readDocument(
  broker: CoreBrokerClient,
  connectionId: string,
  doc: string,
) {
  return broker.execute(
    connectionId,
    prepareInvocation("docs.fetch", "bot", { doc }, "read", true),
  );
}
function gateway() {
  const calls: unknown[] = [];
  const capability = {
    list: async () => ({ connections: [] }),
    describe: async (input: unknown) => {
      calls.push(input);
      return {
        connection: {
          connectionId: "bot-A",
          connectionKind: "feishu",
          label: "Bot A",
          identity: "app",
          health: "working",
        },
        identity: { name: "app", state: "authorized" },
        act: { state: "available" },
      };
    },
    operations: async () => ({
      operations: [{ name: "feishu.document.read", access: "granted" }],
    }),
    invoke: async (input: unknown) => {
      calls.push(input);
      return {
        status: "ok",
        executionId: "execution-fixture",
        data: {
          documentId: "DocumentA",
          content: "SYNTHETIC_DOCUMENT_BODY",
          format: "plain_text",
          complete: true,
        },
      };
    },
  } as unknown as AppConnectionsCapability;
  return { capability, calls };
}
test("Docx link normalization cannot turn input into arbitrary HTTP or a different document", () => {
  assert.equal(documentIdOf("DocumentA"), "DocumentA");
  assert.equal(
    documentIdOf("https://tenant.feishu.cn/docx/DocumentA?from=fixture"),
    "DocumentA",
  );
  assert.equal(
    documentIdOf("https://tenant.larksuite.com/docx/DocumentA"),
    "DocumentA",
  );
  for (const doc of [
    "https://evil.test/docx/DocumentA",
    "https://feishu.cn.evil.test/docx/DocumentA",
    "http://tenant.feishu.cn/docx/DocumentA",
    "https://u:p@tenant.feishu.cn/docx/DocumentA",
    "../DocumentA",
    "https://tenant.feishu.cn/wiki/DocumentA",
  ])
    assert.throws(() => documentIdOf(doc));
});
test("formal SDK calls bind the connection, app grant identity and normalized document ID", async () => {
  const { capability, calls } = gateway();
  const broker = new CoreBrokerClient(capability);
  assert.equal((await broker.describe("bot-A")).identities.bot.available, true);
  await readDocument(
    broker,
    "bot-A",
    "https://tenant.feishu.cn/docx/DocumentA",
  );
  assert.deepEqual(calls, [
    { connectionId: "bot-A", identity: "app" },
    {
      connectionId: "bot-A",
      identity: "app",
      operation: "feishu.document.read",
      input: { documentId: "DocumentA" },
    },
  ]);
  assert.equal((await broker.permissions("bot-A")).status, "query_failed");
});
test("Core reads use no CLI and persist no document body in the app database", async () => {
  const { ctx, native } = testContext();
  const { capability } = gateway();
  ctx.connections = capability;
  let cliCalls = 0;
  const service = new LarkService(ctx, async () => {
    cliCalls++;
    throw new Error("no CLI fallback");
  });
  const input = {
    connectionId: "bot-A",
    command: "docs.fetch",
    identity: "bot" as const,
    parameters: { doc: "DocumentA", scope: "full" },
  };
  assert.deepEqual(await service.invoke(input, "read", guardian), {
    executionId: "execution-fixture",
    ok: true,
    connectionId: "bot-A",
    identity: "bot",
    data: {
      documentId: "DocumentA",
      content: "SYNTHETIC_DOCUMENT_BODY",
      format: "plain_text",
      complete: true,
    },
  });
  for (const changed of [
    { ...input, command: "calendar.agenda", parameters: {} },
    { ...input, identity: "user" as const },
  ])
    await assert.rejects(service.invoke(changed, "read", guardian));
  await assert.rejects(
    service.invoke(
      {
        ...input,
        command: "docs.create",
        parameters: { title: "Fixture" },
        requestId: "fixture-write-001",
        connectionRevision: 0,
      },
      "core_write",
      guardian,
    ),
    /core_operation_not_granted/,
  );
  assert.equal(cliCalls, 0);
  assert.equal(service.repo.activity().length, 0);
  native.close();
});
test("denied and failed provider reads never become successful access checks or CLI fallback", async () => {
  const { ctx, native } = testContext();
  const { capability } = gateway();
  capability.invoke = async () => {
    throw {
      detail: {
        code: "provider_error",
        reason: "provider_scope_required",
        message: "The connection provider rejected the operation.",
        retryable: false,
      },
    };
  };
  ctx.connections = capability;
  const service = new LarkService(ctx, async () => {
    throw new Error("no fallback");
  });
  await assert.rejects(
    service.invoke(
      {
        connectionId: "bot-A",
        command: "docs.fetch",
        identity: "bot",
        parameters: { doc: "DocumentA" },
      },
      "read",
      guardian,
    ),
    /provider_scope_required/,
  );
  native.close();
});

test("SDK errors from another installed package copy retain only validated public error detail", async () => {
  const { capability } = gateway();
  capability.invoke = async () => {
    throw {
      detail: {
        code: "provider_error",
        reason: "provider_resource_denied",
        message: "The connection provider rejected the operation.",
        retryable: false,
      },
      privateData: "SYNTHETIC_NOT_FOR_UI",
    };
  };
  await assert.rejects(
    readDocument(new CoreBrokerClient(capability), "bot-A", "DocumentA"),
    /provider_resource_denied/,
  );
  capability.invoke = async () => {
    throw {
      detail: {
        code: "provider_error",
        message: "SYNTHETIC_NOT_FOR_UI",
        retryable: false,
      },
    };
  };
  await assert.rejects(
    readDocument(new CoreBrokerClient(capability), "bot-A", "DocumentA"),
    (error) =>
      String(error).includes("provider_error") &&
      !String(error).includes("SYNTHETIC_NOT_FOR_UI"),
  );
});

test("final Core provider reasons are independent of human-readable messages", async () => {
  const { capability } = gateway();
  for (const reason of [
    "provider_scope_required",
    "provider_resource_denied",
    "provider_not_found",
    "provider_response_too_large",
    "provider_response_invalid",
    "provider_unavailable",
  ]) {
    capability.invoke = async () => {
      throw {
        detail: {
          code: "provider_error",
          reason,
          message: "SYNTHETIC_PRIVATE_PROVIDER_TEXT",
          retryable: false,
        },
      };
    };
    await assert.rejects(
      readDocument(new CoreBrokerClient(capability), "bot-A", "DocumentA"),
      (error: unknown) =>
        error instanceof Error &&
        error.message === reason &&
        !String(error).includes("SYNTHETIC_PRIVATE_PROVIDER_TEXT"),
    );
  }
});

test("unknown or missing reasons stay generic and message text is never a machine contract", async () => {
  const { capability } = gateway();
  for (const detail of [
    {
      code: "provider_error",
      message: "provider_scope_required",
      retryable: false,
    },
    {
      code: "provider_error",
      reason: "SYNTHETIC_PRIVATE_REASON",
      message: "provider_scope_required",
      retryable: false,
    },
  ]) {
    capability.invoke = async () => {
      throw { detail };
    };
    await assert.rejects(
      readDocument(new CoreBrokerClient(capability), "bot-A", "DocumentA"),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "provider_error" &&
        !String(error).includes("SYNTHETIC_PRIVATE"),
    );
  }
});

test("provider reasons cannot override a Core access denial", async () => {
  const { capability } = gateway();
  capability.invoke = async () => {
    throw {
      detail: {
        code: "access_denied",
        reason: "provider_scope_required",
        message: "SYNTHETIC_PRIVATE_PROVIDER_TEXT",
        retryable: false,
      },
    };
  };
  await assert.rejects(
    readDocument(new CoreBrokerClient(capability), "bot-A", "DocumentA"),
    (error: unknown) =>
      error instanceof Error && error.message === "access_denied",
  );
});
