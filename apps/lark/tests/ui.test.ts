import { afterEach, expect, it, vi } from "vitest";
import { formatError } from "../src/web/i18n.js";
import {
  createSubmissionGate,
  createWriteIntentStore,
  writeResult,
} from "../src/web/write-result.js";
import { ApiResponseError } from "../src/web/api.js";
import { emptyReadSubmission, readSubmission } from "../src/web/read-submission.js";
import {
  coreAccessIssue,
  type CoreConnection,
} from "../src/shared/core-access.js";
import { findCommand } from "../src/shared/catalog.js";
import { commandDetails } from "../src/lib/command-details.js";
import { projectGrantedConnections } from "../src/shared/managed-connections.js";

const granted = {
  act: { state: "available" },
  operations: [],
  grantedOperations: ["feishu.wiki.spaces"],
} as unknown as CoreConnection;

afterEach(() => vi.unstubAllGlobals());

function mockSessionStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}

it.each(["pending_approval", "outcome_unknown", "duplicate", "request_in_progress"])(
  "retains the original write ID and %s receipt when returning to a command",
  (status) => {
    const storage = mockSessionStorage();
    const store = createWriteIntentStore();
    const get = () => store.get("conn_A", "docs.create");
    const listener = vi.fn();
    const unmount = store.subscribe(listener);
    const requestId = store.begin("conn_A", "docs.create")!;
    expect(listener).toHaveBeenCalledTimes(1);
    unmount();

    expect(store.get("conn_B", "docs.create")).toBeUndefined();
    expect(store.get("conn_A", "calendar.create")).toBeUndefined();
    expect(store.connectionFor("docs.create")).toBe("conn_A");
    expect(get()).toMatchObject({ requestId, inFlight: true, receipt: null });
    expect(store.begin("conn_A", "docs.create")).toBeUndefined();
    expect(store.reset("conn_A", "docs.create", true)).toBe(false);
    expect(createWriteIntentStore().get("conn_A", "docs.create")).toMatchObject({
      requestId,
      inFlight: false,
      receipt: { status: "outcome_unknown", requestId },
    });

    store.finish("conn_A", "docs.create", requestId, {
      status,
      approvalId: "approval-A",
      executionId: "execution-A",
      data: { content: "private write contents", ...(status === "duplicate" && { outcome: "succeeded" }) },
    });
    expect(get()).toMatchObject({ requestId, inFlight: false, receipt: { status } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...storage.values()].join("")).not.toContain("private write contents");

    const restored = createWriteIntentStore();
    expect(restored.connectionFor("docs.create")).toBe("conn_A");
    expect(restored.get("conn_A", "docs.create")).toMatchObject({
      requestId,
      inFlight: false,
      receipt: { status, requestId, approvalId: "approval-A", executionId: "execution-A" },
    });
    if (status === "duplicate") {
      expect(restored.get("conn_A", "docs.create")).toHaveProperty("receipt.outcome", "succeeded");
    }
    expect(restored.begin("conn_A", "docs.create")).toBeUndefined();
    expect(restored.reset("conn_A", "docs.create")).toBe(false);
    expect(restored.reset("conn_A", "docs.create", true)).toBe(true);
    expect(createWriteIntentStore().get("conn_A", "docs.create")).toBeUndefined();
    expect(restored.begin("conn_A", "docs.create")).not.toBe(requestId);
  },
);

it("unlocks an in-progress Core receipt only after the fetch and an explicit reset", () => {
  mockSessionStorage();
  const store = createWriteIntentStore();
  const id = store.begin("conn_A", "calendar.create")!;
  expect(store.reset("conn_A", "calendar.create", true)).toBe(false);
  store.finish("conn_A", "calendar.create", id, { status: "request_in_progress" });
  expect(store.reset("conn_A", "calendar.create")).toBe(false);
  expect(store.get("conn_A", "calendar.create")?.requestId).toBe(id);
  expect(store.reset("conn_A", "calendar.create", true)).toBe(true);
  expect(store.begin("conn_A", "calendar.create")).not.toBe(id);
});

it("keeps write receipts and submission locks when sessionStorage is blocked", () => {
  const blocked = () => { throw new Error("storage is disabled"); };
  vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked });
  const store = createWriteIntentStore();
  const requestId = store.begin("local-cli", "docs.create")!;
  expect(store.begin("local-cli", "docs.create")).toBeUndefined();
  store.finish("local-cli", "docs.create", requestId, { status: "pending_approval" });
  expect(store.get("local-cli", "docs.create")).toMatchObject({
    requestId,
    receipt: { status: "pending_approval", requestId },
  });
  expect(store.begin("local-cli", "docs.create")).toBeUndefined();
});

it("clears the prior read result during a rerun and shows only the localized failure", () => {
  const previous = readSubmission(emptyReadSubmission, {
    type: "success",
    result: { status: "ok", data: "previous document" },
  });
  expect(previous.result).toHaveProperty("data", "previous document");
  const pending = readSubmission(previous, { type: "start" });
  expect(pending).toEqual({ result: null, error: null });

  for (const [error, localized] of [
    [new ApiResponseError("authorization_required", 403), "授权"],
    [new ApiResponseError("http_502", 502), "暂时无法完成"],
    [new TypeError("Failed to fetch"), "暂时无法完成"],
  ] as const) {
    const failed = readSubmission(pending, { type: "failure", error });
    expect(failed.result).toBeNull();
    expect(formatError(failed.error!.message, 0)).toContain(localized);
    expect(readSubmission(failed, { type: "start" })).toEqual(pending);
  }

  const rejected = readSubmission(pending, {
    type: "success",
    result: { status: "error", error: "provider_scope_required" },
  });
  expect(rejected.result).toBeNull();
  expect(formatError(rejected.error!.message, 0)).toContain("应用权限");
  expect(readSubmission(previous, { type: "revoke" })).toEqual(pending);
});

it("gates exact operations, selected identity, missing descriptors and revoked Act state", () => {
  const wiki = findCommand("wiki.spaces");
  expect(coreAccessIssue(wiki, "bot", granted)).toBeUndefined();
  expect(coreAccessIssue(wiki, "bot")).toBe("connection_unavailable");
  expect(coreAccessIssue(wiki, "user", granted)).toBe(
    "core_user_identity_unsupported",
  );
  expect(
    coreAccessIssue(wiki, "bot", { ...granted, grantedOperations: [] }),
  ).toBe("core_operation_not_granted");
  expect(
    coreAccessIssue(wiki, "bot", { ...granted, act: { state: "unsupported" } }),
  ).toBe("connection_unavailable");
  expect(coreAccessIssue(findCommand("docs.fetch"), "bot", granted)).toBe(
    "core_operation_not_granted",
  );
  expect(coreAccessIssue(findCommand("im.search"), "bot", granted)).toBe(
    "core_user_identity_unsupported",
  );
});

it("renders broker receipts and outer action approvals with the original identifiers", () => {
  const ids = { approvalId: "A", requestId: "R", executionId: "E" };
  expect(
    writeResult({ status: "ok", data: { status: "pending_approval", ...ids } }),
  ).toMatchObject({ waiting: true, unknown: false, ...ids });
  expect(writeResult({ status: "pending_approval", ...ids })).toMatchObject({
    waiting: true,
    ...ids,
  });
  expect(
    writeResult({ status: "outcome_unknown", requestId: "R" }),
  ).toMatchObject({ unknown: true, requestId: "R" });
  expect(writeResult({ data: { outcomeUnknown: true } }).unknown).toBe(true);
  expect(
    writeResult({ data: { status: "request_in_progress" } }).inProgress,
  ).toBe(true);
  expect(writeResult({ data: { status: "duplicate" } }).duplicate).toBe(true);
  expect(
    writeResult({ status: "error", error: "outcome_unknown_do_not_retry" })
      .unknown,
  ).toBe(true);
  expect(
    writeResult({ status: "error", error: "request_in_progress" }).inProgress,
  ).toBe(true);
  expect(writeResult(null)).toMatchObject({
    waiting: false,
    unknown: false,
    inProgress: false,
    duplicate: false,
  });
});

it.each(["ok", "pending_approval", "outcome_unknown"])(
  "allocates one ID per write intent and waits for a new intent after %s",
  (status) => {
    const gate = createSubmissionGate();
    expect(gate.begin(true, true)?.requestId).toBeUndefined();
    gate.finish();

    const first = gate.begin(false, true);
    expect(first?.requestId).toMatch(/^lark-ui-[a-f0-9-]{36}$/);
    expect(gate.begin(false, true)).toBeUndefined();
    expect(gate.newIntent()).toBe(false);

    const receipt = writeResult({ status, requestId: first?.requestId });
    gate.finish(true);
    expect(receipt.requestId).toBe(first?.requestId);
    expect(gate.begin(true, true)?.requestId).toBeUndefined();
    gate.finish();
    expect(gate.begin(false, true)).toBeUndefined();

    expect(gate.newIntent()).toBe(true);
    const next = gate.begin(false, true);
    expect(next?.requestId).toMatch(/^lark-ui-[a-f0-9-]{36}$/);
    expect(next?.requestId).not.toBe(first?.requestId);
  },
);

it("localizes errors and preserves the distinction between grants, scope errors and transport errors", () => {
  expect(formatError("core_operation_not_granted", 0)).toContain(
    "Rome 设置 → 对应飞书连接详情页",
  );
  expect(formatError("core_user_identity_unsupported", 1)).toMatch(
    /local-cli.*OAuth/,
  );
  expect(formatError("outcome_unknown", 0)).toContain("不要直接重试");
  expect(formatError("provider_scope_required", 0)).toContain("应用权限");
  expect(formatError("provider_unavailable", 0)).not.toContain("权限");
  expect(formatError("provider_response_invalid", 1)).toContain(
    "valid response",
  );
});

it("reports separate Core and CLI input schemas, including actual cell/Docx display shapes and Core write receipts", () => {
  const records = commandDetails("base.records");
  expect(records.inputSchema.properties).toHaveProperty("offset");
  expect(records).toHaveProperty(
    "coreInputSchema.properties.page-size.maximum",
    200,
  );
  expect(records).not.toHaveProperty("coreInputSchema.properties.offset");
  const agenda = commandDetails("calendar.agenda");
  expect(agenda).toHaveProperty("coreInputSchema.properties.page-size", {
    type: "integer",
    description: "Page size",
    minimum: 50,
    maximum: 200,
    default: 50,
  });
  expect(agenda.inputSchema.properties).not.toHaveProperty("page-size");
  expect(JSON.stringify(commandDetails("sheets.cells"))).toContain(
    "valuesPreview",
  );
  expect(JSON.stringify(commandDetails("docs.fetch"))).toContain("complete");
  expect(JSON.stringify(commandDetails("calendar.create"))).toContain(
    "pending_approval",
  );
  expect(commandDetails("calendar.create")).toMatchObject({
    coreReceiptSchema: {
      anyOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            status: { type: "string", const: "pending_approval" },
            approval: expect.objectContaining({
              required: expect.arrayContaining(["approvalId"]),
            }),
          }),
        }),
      ]),
    },
  });
  expect(commandDetails("im.search")).not.toHaveProperty("coreAction");
});

it("rejects a reserved local-cli identity from the Core directory", () => {
  expect(() =>
    projectGrantedConnections({
      connections: [
        {
          connectionKind: "feishu",
          identity: "app",
          connectionId: "local-cli",
        },
      ],
    }),
  ).toThrow();
});
