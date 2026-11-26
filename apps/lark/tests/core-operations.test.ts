import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppConnectionError,
  type AppConnectionsCapability,
} from "@rome-os/app-runtime";
import { LarkService } from "../src/lib/service.js";
import { CoreBrokerClient } from "../src/lib/core-broker.js";
import {
  COMMANDS,
  findCommand,
  SCOPE_OPERATION,
} from "../src/shared/catalog.js";
import { coreAccessIssue } from "../src/shared/core-access.js";
import { coreWriteSchema } from "../src/actions/core-write/index.js";
import { writeSchema } from "../src/actions/input.js";
import { guardian, testContext } from "./helpers.js";

const page = { hasMore: true, pageToken: "next" };
const paged = { "page-token": "cursor" };
const doc = {
  documentId: "D1",
  content: "# A\nOne match\nTitle\n===\nMATCH again\n第二章 说明",
  format: "plain_text",
  complete: true,
};
const table = {
  "base-token": "https://org.feishu.cn/base/B1",
  "table-id": "T1",
};
const event = { eventId: "e@1", summary: "Review" };
const node = {
  spaceId: "S",
  nodeToken: "N",
  objToken: "O",
  objType: "docx",
  hasChild: true,
};
const start = "2026-11-25T08:00:00.000+08:00",
  end = "2026-11-25T09:00:00+08:00";
type Fixture = [
  string,
  string,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
];
const fixtures: Fixture[] = [
  [
    "docs.fetch",
    "document.read",
    { doc: "https://x.larksuite.com/docx/D1?from=fixture" },
    { documentId: "D1" },
    doc,
  ],
  [
    "docs.create",
    "document.create",
    { title: "T", "parent-token": "F-1" },
    { title: "T", folderToken: "F-1" },
    { documentId: "D1", title: "T", blockCount: 0 },
  ],
  [
    "docs.update",
    "document.update",
    { doc: "D1", command: "overwrite", content: "plain" },
    { documentId: "D1", mode: "overwrite", content: "plain" },
    { documentId: "D1", mode: "overwrite", revisionId: 11, blocksAdded: 1 },
  ],
  [
    "drive.inspect",
    "drive.inspect",
    { url: "https://tenant.feishu.cn/drive/folder/F_1" },
    { type: "folder", token: "F_1" },
    { type: "folder", token: "F_1", ownerId: "owner" },
  ],
  [
    "wiki.spaces",
    "wiki.spaces",
    { ...paged, "page-size": 50 },
    { pageToken: "cursor", pageSize: 50 },
    { ...page, items: [{ spaceId: "S" }] },
  ],
  [
    "wiki.node",
    "wiki.node.get",
    { "node-token": "https://x.larksuite.com/wiki/N" },
    { nodeToken: "N" },
    { ...node, nodeType: "origin" },
  ],
  [
    "wiki.nodes",
    "wiki.nodes.list",
    { "space-id": "S", "parent-node-token": "P", ...paged },
    { spaceId: "S", parentNodeToken: "P", pageToken: "cursor" },
    { ...page, items: [node] },
  ],
  [
    "base.get",
    "base.get",
    { "base-token": "https://x.larkoffice.com/bitable/B1" },
    { appToken: "B1" },
    { appToken: "B1", name: "Base" },
  ],
  [
    "base.tables",
    "base.tables.list",
    { "base-token": "B1", "page-size": 100 },
    { appToken: "B1", pageSize: 100 },
    { ...page, items: [{ tableId: "T1" }] },
  ],
  [
    "base.fields",
    "base.fields.list",
    { ...table, ...paged },
    { appToken: "B1", tableId: "T1", pageToken: "cursor" },
    {
      ...page,
      items: [{ fieldId: "F", fieldName: "Name", type: 1, isPrimary: true }],
    },
  ],
  [
    "base.records",
    "base.records.list",
    { ...table, "view-id": "V", "page-size": 200 },
    { appToken: "B1", tableId: "T1", viewId: "V", pageSize: 200 },
    {
      ...page,
      total: 3,
      items: [{ recordId: "R", fields: { name: "N", nested: [null, false] } }],
    },
  ],
  [
    "sheets.info",
    "sheets.info",
    { url: "https://x.feishu.cn/sheets/X1" },
    { spreadsheetToken: "X1" },
    { spreadsheetToken: "X1", sheets: [{ sheetId: "S", rowCount: 20 }] },
  ],
  [
    "sheets.cells",
    "sheets.cells.read",
    { url: "X1", "sheet-id": "S", range: "A1:D4" },
    { spreadsheetToken: "X1", sheetId: "S", range: "A1:D4" },
    {
      spreadsheetToken: "X1",
      sheetId: "S",
      range: "A1:D4",
      revision: 3,
      values: [[null, 1, "sample"]],
    },
  ],
  [
    "calendar.agenda",
    "calendar.events.list",
    { start: "12345", end },
    {
      calendarId: "primary",
      startTime: "12345",
      endTime: end,
      pageSize: 50,
    },
    {
      calendarId: "primary",
      ...page,
      items: [{ ...event, organizerCalendarId: "other" }],
    },
  ],
  [
    "calendar.get",
    "calendar.event.get",
    { "calendar-id": "a@calendar", "event-id": "e@1" },
    { calendarId: "a@calendar", eventId: "e@1" },
    { ...event, calendarId: "a@calendar", location: "Meeting room" },
  ],
  [
    "calendar.search",
    "calendar.events.search",
    { query: "review", end, "page-size": 50 },
    { calendarId: "primary", query: "review", endTime: end, pageSize: 50 },
    { calendarId: "primary", ...page, items: [event] },
  ],
  [
    "calendar.create",
    "calendar.event.create",
    {
      summary: "T",
      description: "D",
      start,
      end,
      "attendee-ids": "ou_a, ou_b",
    },
    {
      calendarId: "primary",
      summary: "T",
      description: "D",
      startTime: start,
      endTime: end,
      attendeeOpenIds: ["ou_a", "ou_b"],
    },
    {
      calendarId: "primary",
      eventId: "e",
      summary: "T",
      startTime: start,
      endTime: end,
      attendeesAdded: 2,
    },
  ],
  [
    "im.history",
    "im.messages.list",
    { "chat-id": "oc_A", order: "asc", start: "12345", ...paged },
    {
      chatId: "oc_A",
      sortOrder: "asc",
      startTime: "12345",
      pageToken: "cursor",
    },
    {
      chatId: "oc_A",
      ...page,
      items: [
        {
          messageId: "M",
          msgType: "text",
          createTime: "12345",
          bodyContent: "text",
          sender: { id: "ou_A" },
        },
      ],
    },
  ],
];
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

function harness(command = "docs.create", data: unknown = {}) {
  const { ctx, native } = testContext();
  cleanup.push(() => native.close());
  const spec = findCommand(command);
  const op = {
    name: spec.coreOperation,
    access: "granted",
    sideEffects: spec.risk === "write" ? "write" : "read-only",
    approval: spec.risk === "write" ? "required" : "not_required",
  };
  const descriptor = {
    connection: {
      connectionId: "bot-A",
      connectionKind: "feishu",
      label: "Bot",
    },
    identity: { name: "app" },
    act: { state: "available" },
  };
  const gateway = {
    describe: vi.fn(async () => descriptor),
    operations: vi.fn(
      async (_args: {
        cursor?: string;
      }): Promise<{ operations: (typeof op)[]; nextCursor?: string }> => ({
        operations: [op],
      }),
    ),
    invoke: vi.fn(async (_input: unknown): Promise<unknown> => ({
      status: "ok",
      executionId: "exec-A",
      data,
    })),
  };
  ctx.connections = gateway as unknown as AppConnectionsCapability;
  const runner = vi.fn(async () => {
    throw Error("unexpected local CLI");
  });
  const service = new LarkService(ctx, runner);
  const broker = new CoreBrokerClient(ctx.connections);
  const requestId = "a".repeat(200);
  const run = (parameters: Record<string, unknown> = { title: "T" }) =>
    service.invoke(
      {
        connectionId: "bot-A",
        identity: "bot",
        command,
        parameters,
        ...(spec.risk === "write" && { requestId, connectionRevision: 0 }),
      },
      spec.risk === "write" ? "core_write" : "read",
      guardian,
    );
  return {
    ctx,
    op,
    gateway,
    broker,
    descriptor,
    run,
    runner,
    requestId,
    service,
  };
}

it.each(fixtures)(
  "%s uses the exact Core operation, identity, wire input and output",
  async (command, operation, params, input, output) => {
    const h = harness(command, output);
    const result = await h.run(params);
    expect(result).toMatchObject({
      ok: true,
      data: output,
      connectionId: "bot-A",
      executionId: "exec-A",
    });
    expect(h.gateway.invoke).toHaveBeenCalledExactlyOnceWith({
      connectionId: "bot-A",
      identity: "app",
      operation: "feishu." + operation,
      input,
      ...(findCommand(command).risk === "write" && { requestId: h.requestId }),
    });
    expect(h.runner).not.toHaveBeenCalled();
  },
);

it("covers exactly the locked catalog and permissions operation", () => {
  const operations = [
    ...COMMANDS.flatMap((c) => (c.coreOperation ? [c.coreOperation] : [])),
    SCOPE_OPERATION,
  ].sort();
  expect(operations).toEqual(
    [...fixtures.map((f) => "feishu." + f[1]), "feishu.scopes.list"].sort(),
  );
  expect(new Set(operations).size).toBe(19);
});

it("queries real scopes, preserves unknown statuses and distinguishes unauthorized, failed and empty snapshots", async () => {
  const h = harness();
  const snapshot = {
    checkedAt: start,
    scopes: [
      { scopeName: "read", grantStatus: 1, scopeType: "tenant" },
      { scopeName: "write", grantStatus: 2 },
      { scopeName: "other", grantStatus: 9 },
    ],
  };
  h.gateway.invoke.mockResolvedValueOnce({ status: "ok", data: snapshot });
  expect(await h.broker.permissions("bot-A")).toEqual({
    status: "checked",
    connectionId: "bot-A",
    ...snapshot,
  });
  expect(h.gateway.invoke).toHaveBeenCalledExactlyOnceWith({
    connectionId: "bot-A",
    identity: "app",
    operation: "feishu.scopes.list",
    input: {},
  });
  for (const [code, status] of [
    ["access_denied", "unauthorized"],
    ["authorization_required", "unauthorized"],
    ["resource_denied", "unauthorized"],
    ["provider_error", "query_failed"],
  ]) {
    h.gateway.invoke.mockRejectedValueOnce({
      detail: { code, message: "private", retryable: false },
    });
    expect(await h.broker.permissions("bot-A")).toEqual({
      connectionId: "bot-A",
      status,
      error: code,
    });
  }
  for (const [reason, status, retryable] of [
    ["provider_resource_denied", "unauthorized", false],
    ["provider_scope_required", "unauthorized", false],
    ["provider_unavailable", "query_failed", true],
  ] as const) {
    h.gateway.invoke.mockRejectedValueOnce({
      detail: { code: "provider_error", reason, message: "private", retryable },
    });
    expect(await h.broker.permissions("bot-A")).toEqual({
      connectionId: "bot-A",
      status,
      error: reason,
    });
  }
  h.gateway.invoke.mockRejectedValueOnce(new TypeError("network failure"));
  expect(await h.broker.permissions("bot-A")).toMatchObject({
    status: "query_failed",
    error: "core_gateway_unavailable",
  });
  h.gateway.invoke.mockResolvedValueOnce({
    status: "ok",
    data: { scopes: [null] },
  });
  expect(await h.broker.permissions("bot-A")).toMatchObject({
    status: "query_failed",
  });
  h.gateway.invoke.mockResolvedValueOnce({
    status: "ok",
    data: { checkedAt: start, scopes: [] },
  });
  expect(await h.broker.permissions("bot-A")).toMatchObject({
    status: "checked",
    scopes: [],
  });
});

it("returns only bot-applicable scopes regardless of the user's grant status", async () => {
  const botScopes = [
    { scopeName: "tenant-read", grantStatus: 1, scopeType: "tenant" },
    { scopeName: "tenant-write", grantStatus: 2, scopeType: "TENANT" },
    { scopeName: "unspecified-read", grantStatus: 1 },
    { scopeName: "unspecified-write", grantStatus: 2 },
  ];
  const h = harness("docs.create", {
    checkedAt: start,
    scopes: [
      ...botScopes,
      { scopeName: "user-read", grantStatus: 1, scopeType: "user" },
      { scopeName: "user-write", grantStatus: 2, scopeType: "UsEr" },
      { scopeName: "other", grantStatus: 1, scopeType: "unknown" },
    ],
  });
  expect(await h.broker.permissions("bot-A")).toEqual({
    status: "checked",
    connectionId: "bot-A",
    checkedAt: start,
    scopes: botScopes,
  });
});

it("accumulates all operation pages and checks the precise grant without a document read grant", async () => {
  const h = harness("wiki.spaces", { items: [], hasMore: false });
  const denied = {
    ...h.op,
    name: "feishu.document.read",
    access: "not_granted",
  };
  h.gateway.operations.mockImplementation(async (args) =>
    args.cursor
      ? { operations: [h.op] }
      : { operations: [denied], nextCursor: "second" },
  );
  const desc = await h.broker.describe("bot-A");
  expect(desc).toMatchObject({
    identities: { bot: { available: true } },
    operations: [denied, h.op],
    grantedOperations: ["feishu.wiki.spaces"],
  });
  expect(h.gateway.operations.mock.calls.map(([a]) => a)).toEqual([
    { connectionId: "bot-A", identity: "app", limit: 50 },
    { connectionId: "bot-A", identity: "app", limit: 50, cursor: "second" },
  ]);
  expect(await h.run({})).toMatchObject({ ok: true });
  expect(coreAccessIssue(findCommand("docs.fetch"), "bot", desc)).toBe(
    "core_operation_not_granted",
  );
  h.descriptor.act.state = "unavailable";
  await expect(h.run({})).rejects.toThrow("connection_unavailable");
  expect(h.gateway.invoke).toHaveBeenCalledTimes(1);
});

it("fails closed on repeated cursors and on a 21st page", async () => {
  const h = harness();
  h.gateway.operations.mockResolvedValue({
    operations: [h.op],
    nextCursor: "loop",
  });
  await expect(h.broker.describe("bot-A")).rejects.toThrow(
    "incomplete_operation_list",
  );
  h.gateway.operations.mockImplementation(async ({ cursor }) => ({
    operations: [h.op],
    nextCursor: String(Number(cursor ?? 0) + 1),
  }));
  h.gateway.operations.mockClear();
  await expect(h.broker.describe("bot-A")).rejects.toThrow(
    "incomplete_operation_list",
  );
  expect(h.gateway.operations).toHaveBeenCalledTimes(20);
});

it.each(["docs.search", "im.search", "im.send_as_user"])(
  "%s requires explicit user access and never falls back to CLI",
  async (command) => {
    const h = harness(command);
    const spec = findCommand(command);
    expect(spec.identities).toEqual(["user"]);
    for (const identity of ["bot", "user"] as const) {
      await expect(
        h.service.invoke(
          {
            connectionId: "bot-A",
            command,
            identity,
            parameters: spec.example,
            connectionRevision: 0,
            requestId: h.requestId,
          },
          spec.risk === "write" ? "core_write" : "read",
          guardian,
        ),
      ).rejects.toThrow("core_user_identity_unsupported");
    }
    expect(h.gateway.invoke).not.toHaveBeenCalled();
    expect(h.runner).not.toHaveBeenCalled();
  },
);

describe("Core-owned writes", () => {
  it.each([
    [
      "pending_approval",
      {
        approval: {
          approvalId: "approval-A",
          actionName: "test:write",
          description: "Fixture approval",
        },
      },
      {
        approvalId: "approval-A",
        approval: {
          approvalId: "approval-A",
          actionName: "test:write",
          description: "Fixture approval",
        },
        ok: false,
      },
    ],
    ["duplicate", { outcome: "succeeded" }, { outcome: "succeeded", ok: true }],
    [
      "duplicate",
      { outcome: "failed", errorCode: "approval_rejected" },
      { ok: false, error: "approval_rejected" },
    ],
    ["outcome_unknown", {}, { ok: false, outcomeUnknown: true }],
  ] as const)(
    "returns %s with stable IDs and no replay",
    async (status, fields, expected) => {
      const h = harness();
      h.gateway.invoke.mockResolvedValueOnce({
        status,
        executionId: "E",
        ...fields,
      });
      expect(await h.run()).toMatchObject({
        ...expected,
        status,
        executionId: "E",
        requestId: h.requestId,
        retryAllowed: false,
      });
      expect(h.gateway.invoke).toHaveBeenCalledTimes(1);
      expect(h.runner).not.toHaveBeenCalled();
    },
  );
  it.each(["outcome_unknown", "request_in_progress"] as const)(
    "handles SDK error %s without creating a fresh ID",
    async (code) => {
      const h = harness();
      h.gateway.invoke.mockRejectedValueOnce(
        new AppConnectionError({ code, retryable: false, message: "private" }),
      );
      expect(await h.run()).toMatchObject({
        status: code,
        ok: false,
        requestId: h.requestId,
        retryAllowed: false,
      });
      expect(h.gateway.invoke).toHaveBeenCalledTimes(1);
      expect(h.runner).not.toHaveBeenCalled();
    },
  );
  it("treats lost responses and malformed post-write receipts as uncertain", async () => {
    const h = harness();
    h.gateway.invoke.mockRejectedValueOnce(Error("transport disconnected"));
    expect(await h.run()).toMatchObject({
      status: "outcome_unknown",
      retryAllowed: false,
    });
    expect(await h.run()).toMatchObject({
      status: "outcome_unknown",
      executionId: "exec-A",
    });
  });
  it.each([
    { status: "pending_approval", executionId: "E", approval: {} },
    { status: "duplicate", executionId: "E" },
    { status: "unexpected", executionId: "E" },
  ])("locks malformed write receipts after submission", async (receipt) => {
    const h = harness();
    h.gateway.invoke.mockResolvedValueOnce(receipt);
    expect(await h.run()).toMatchObject({
      status: "outcome_unknown",
      requestId: h.requestId,
      retryAllowed: false,
    });
    expect(h.gateway.invoke).toHaveBeenCalledTimes(1);
  });
  it("prevents bypassing local approval or accepting unsafe broker writes", async () => {
    const h = harness();
    h.op.approval = "not_required";
    await expect(h.run()).rejects.toThrow("core_approval_unavailable");
    expect(h.gateway.invoke).not.toHaveBeenCalled();
    const args = {
      command: "docs.create",
      parameters: { title: "T" },
      identity: "bot",
      connectionRevision: 0,
      requestId: "12345678",
    };
    for (const connectionId of [undefined, "local-cli"])
      expect(coreWriteSchema.safeParse({ ...args, connectionId }).success).toBe(
        false,
      );
    for (const n of [7, 8, 200, 201])
      expect(
        writeSchema.safeParse({ ...args, requestId: "x".repeat(n) }).success,
      ).toBe(n >= 8 && n <= 200);
  });

  it("validates and normalizes request IDs before reaching Core", async () => {
    const output = fixtures.find(([command]) => command === "docs.create")![4];
    const h = harness("docs.create", output);
    const args = {
      connectionId: "bot-A",
      command: "docs.create",
      parameters: { title: "T" },
      identity: "bot" as const,
      connectionRevision: 0,
    };
    for (const requestId of [undefined, "x".repeat(7), "x".repeat(201)]) {
      await expect(
        h.service.invoke({ ...args, requestId }, "core_write", guardian),
      ).rejects.toThrow("request_id_required");
    }
    expect(h.gateway.invoke).not.toHaveBeenCalled();
    const requestId = "lark:write:123456";
    expect(
      await h.service.invoke({ ...args, requestId: ` ${requestId} ` }, "core_write", guardian),
    ).toMatchObject({ ok: true, requestId });
    expect(h.gateway.invoke).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ requestId }),
    );
  });

  it("rejects a calendar event whose start and end fall in the same Unix second", async () => {
    const h = harness("calendar.create");
    await expect(
      h.run({
        summary: "T",
        start: "2026-11-26T06:00:00.100Z",
        end: "2026-11-26T06:00:00.900Z",
      }),
    ).rejects.toThrow("invalid_time_range");
    expect(h.gateway.invoke).not.toHaveBeenCalled();
  });
});

it("filters complete plain text locally and never sends a filter or keyword to Core", async () => {
  const h = harness("docs.fetch", doc);
  for (const [params, content] of [
    [{ scope: "outline" }, "# A\nTitle\n第二章 说明"],
    [{ scope: "keyword", keyword: "match" }, "One match\nMATCH again"],
    [{ scope: "keyword", keyword: "absent" }, ""],
  ] as const) {
    expect(await h.run({ doc: "D1", ...params })).toMatchObject({
      data: { content, complete: false, scope: params.scope },
    });
    expect(h.gateway.invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: { documentId: "D1" } }),
    );
  }
});

it("bounds cell display without losing range and revision or exposing full values", async () => {
  const f = fixtures.find((f) => f[0] === "sheets.cells")!;
  const h = harness(f[0], f[4]);
  const result = await h.run({ ...f[2], "max-chars": 5 });
  expect(result).toMatchObject({
    data: {
      maxChars: 5,
      truncated: true,
      range: "A1:D4",
      revision: 3,
      valuesPreview: "[[nul",
    },
  });
  expect(result).not.toHaveProperty("data.values");
});

it.each([50, 200])(
  "continues a Core agenda with page size %i and no time filters",
  async (pageSize) => {
    const h = harness("calendar.agenda", {
      calendarId: "primary",
      items: [],
      hasMore: false,
    });
    await h.run({ ...paged, "page-size": pageSize });
    expect(h.gateway.invoke).toHaveBeenCalledExactlyOnceWith({
      connectionId: "bot-A",
      identity: "app",
      operation: "feishu.calendar.events.list",
      input: { calendarId: "primary", pageToken: "cursor", pageSize },
    });
  },
);

it.each([49, 201])(
  "rejects Core agenda page size %i before invocation",
  async (pageSize) => {
    const h = harness("calendar.agenda");
    await expect(h.run({ "page-size": pageSize })).rejects.toMatchObject({
      code: "invalid_parameter",
      detail: "page-size",
    });
    expect(h.gateway.invoke).not.toHaveBeenCalled();
  },
);

it.each(["start", "end"])(
  "rejects a Core agenda cursor combined with %s",
  async (key) => {
    const h = harness("calendar.agenda");
    await expect(h.run({ ...paged, [key]: start })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(h.gateway.invoke).not.toHaveBeenCalled();
  },
);

it.each([
  ["drive.inspect", { url: "Bare" }],
  ["drive.inspect", { url: "https://x.feishu.cn/wiki/N", type: "docx" }],
  ["wiki.node", { "node-token": "https://feishu.cn/docx/D" }],
  ["base.get", { "base-token": "https://feishu.cn.evil.com/base/B" }],
  ["base.records", { ...table, offset: 5 }],
  ["base.tables", { "base-token": "B", "page-size": 101 }],
  ["sheets.cells", { url: "X", "sheet-id": "A", range: "A1!bad" }],
  ["calendar.search", { query: "x".repeat(201) }],
  ["calendar.agenda", { start: "yesterday" }],
  [
    "calendar.create",
    {
      summary: "T",
      start,
      end,
      "attendee-ids": Array(21).fill("ou_a").join(","),
    },
  ],
  ["docs.create", { title: "x".repeat(201) }],
  ["docs.update", { doc: "D", command: "append", content: "" }],
] as const)(
  "rejects invalid %s input before invocation",
  async (command, params) => {
    const h = harness(command);
    await expect(h.run(params)).rejects.toThrow();
    expect(h.gateway.invoke).not.toHaveBeenCalled();
  },
);
it("allows typed bare Drive tokens", async () => {
  const h = harness("drive.inspect", { type: "doc", token: "D" });
  await h.run({ url: "D", type: "doc" });
  expect(h.gateway.invoke).toHaveBeenCalledWith(
    expect.objectContaining({ input: { type: "doc", token: "D" } }),
  );
});
