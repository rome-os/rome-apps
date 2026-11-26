import { test } from "vitest";
import assert from "node:assert/strict";
import {
  projectManagedConnections,
  permissionConsole,
} from "../src/shared/managed-connections.js";
import { resolveConnection } from "../src/lib/connection-policy.js";
import { CoreBrokerClient } from "../src/lib/core-broker.js";
import { LarkService } from "../src/lib/service.js";
import { invocationSchema } from "../src/actions/input.js";
import { testContext, guardian } from "./helpers.js";

const row = (id: string) => ({
  id,
  service: "feishu",
  label: `Fixture ${id}`,
  grants: { app: "authorized" },
  display: { app: { handle: `cli_${id}` } },
  capabilities: { talk: { state: "unlocked" }, act: { state: "unsupported" } },
});

test("managed connection projection keeps multiple identities and only public allowlisted fields", () => {
  const result = projectManagedConnections({
    connections: [
      {
        ...row("one"),
        credential: "SYNTHETIC_SECRET",
        profile: { appSecret: "SYNTHETIC_SECRET" },
      },
      row("two"),
      { ...row("other"), service: "slack" },
      { ...row("placeholder"), id: null },
    ],
  });
  assert.deepEqual(
    result.map((r) => r.id),
    ["one", "two"],
  );
  assert.equal(result[0]?.appId, "cli_one");
  assert.equal(result[0]?.grant, "authorized");
  assert(!JSON.stringify(result).includes("SYNTHETIC_SECRET"));
  assert(!JSON.stringify(result).includes("delegationAvailable"));
});

test("unknown capabilities and absent profiles stay unknown; malformed or duplicate identities fail closed", () => {
  const result = projectManagedConnections({
    connections: [
      {
        ...row("one"),
        grants: {},
        display: {},
        capabilities: { talk: { state: "new-state" } },
      },
    ],
  });
  assert.equal(result[0]?.appId, null);
  assert.equal(result[0]?.talk, "unknown");
  assert.equal(result[0]?.grant, "unknown");
  for (const value of [
    {},
    { connections: "wrong" },
    { connections: [row("one"), row("one")] },
    { connections: [row("local-cli")] },
    { connections: [row("../two")] },
  ])
    assert.throws(
      () => projectManagedConnections(value),
      /invalid_connections_response/,
    );
});

test("permission console links have fixed official origins and cannot carry arbitrary URLs", () => {
  assert.equal(
    permissionConsole("cli_one", "feishu"),
    "https://open.feishu.cn/app/cli_one/auth",
  );
  assert.equal(
    permissionConsole("cli_two", "lark"),
    "https://open.larksuite.com/app/cli_two/auth",
  );
  assert.equal(
    permissionConsole("https://example.test", "feishu"),
    "https://open.feishu.cn/app",
  );
  assert.equal(
    permissionConsole(null, "lark"),
    "https://open.larksuite.com/app",
  );
});

test("schema preserves an explicit connection and never silently strips a misspelled selector", async () => {
  const value = invocationSchema.parse({
    connectionId: "core-one",
    command: "calendar.agenda",
    identity: "bot",
    parameters: {},
  });
  assert.equal(value.connectionId, "core-one");
  assert.equal(
    invocationSchema.safeParse({
      connectionID: "core-one",
      command: "calendar.agenda",
      identity: "bot",
      parameters: {},
    }).success,
    false,
  );
  assert.equal(await resolveConnection({ identity: "bot" }, "read"), undefined);
  assert.equal(
    await resolveConnection(
      { identity: "bot", connectionId: "local-cli" },
      "read",
    ),
    undefined,
  );
});

test("a selected Core connection cannot fall back to the independent CLI", async () => {
  const { ctx, native } = testContext();
  let calls = 0;
  const service = new LarkService(ctx, async () => {
    calls++;
    throw new Error("must not run");
  });
  await assert.rejects(
    service.invoke(
      {
        connectionId: "core-one",
        command: "docs.fetch",
        identity: "bot",
        parameters: { doc: "DocumentA" },
      },
      "read",
      guardian,
    ),
    /core_gateway_unavailable/,
  );
  assert.equal(calls, 0);
  assert.equal(service.repo.activity().length, 0);
  native.close();
});
