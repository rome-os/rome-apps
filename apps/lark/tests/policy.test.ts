import { test } from "vitest";
import assert from "node:assert/strict";
import {
  assertGuardian,
  prepareInvocation,
  redact,
} from "../src/lib/policy.js";
import { COMMANDS, commandSchema } from "../src/shared/catalog.js";
import { verificationLink } from "../src/lib/setup.js";
import { guardian } from "./helpers.js";
test("guardian identity is runtime-bound and fails closed", () => {
  assert.doesNotThrow(() => assertGuardian(guardian));
  assert.doesNotThrow(() =>
    assertGuardian({
      channelContext: {
        channel: "webchat",
        threadId: "x",
        threadType: "private",
      },
    }),
  );
  assert.doesNotThrow(() => assertGuardian({ callerAppId: "lark" }));
  for (const context of [
    undefined,
    {},
    { callerAppId: "other" },
    { channelContext: { channel: "feishu", threadId: "x" } },
    {
      channelContext: {
        channel: "feishu",
        threadId: "x",
        senderBondLevel: "other",
      },
    },
    {
      channelContext: {
        ...guardian.channelContext,
        threadType: "group" as const,
      },
    },
    {
      callerAppId: "lark",
      channelContext: {
        channel: "webchat",
        threadId: "x",
        senderBondLevel: "other",
      },
    },
  ])
    assert.throws(() => assertGuardian(context));
});
test("all curated examples are valid and have exact parameter schemas", () => {
  assert.equal(new Set(COMMANDS.map((c) => c.id)).size, COMMANDS.length);
  for (const spec of COMMANDS) {
    const call = prepareInvocation(
      spec.id,
      spec.identities[0]!,
      spec.example,
      spec.risk,
    );
    assert.equal(call.argv[0], spec.argv[0]);
    assert.equal(commandSchema(spec).additionalProperties, false);
  }
});
test("raw commands, flags, file-input and foreign URLs are refused", () => {
  assert.throws(() => prepareInvocation("api", "user", {}));
  assert.throws(() =>
    prepareInvocation("docs.search", "user", {
      query: "x",
      "app-secret": "secret",
    }),
  );
  assert.throws(() =>
    prepareInvocation("docs.fetch", "user", { doc: "@/etc/passwd" }),
  );
  assert.throws(() =>
    prepareInvocation("docs.fetch", "user", {
      doc: "https://feishu.cn.evil.test/docx/x",
    }),
  );
  assert.throws(() =>
    prepareInvocation("docs.fetch", "user", { doc: "file:///etc/passwd" }),
  );
  assert.throws(() =>
    prepareInvocation("docs.fetch", "user", {
      doc: "https://a:b@foo.feishu.cn/docx/x",
    }),
  );
  assert.throws(() =>
    prepareInvocation("base.records", "user", {
      "base-token": "x",
      "table-id": "tbl_x",
      limit: 201,
    }),
  );
  assert.throws(() =>
    prepareInvocation("base.records", "user", {
      "base-token": "x",
      "table-id": "tbl_x",
      limit: "50",
    }),
  );
  assert.throws(() =>
    prepareInvocation("docs.create", "user", {
      title: "x",
      content: "![image](../secret)",
    }),
  );
  assert.throws(() => prepareInvocation("docs.search", "bot", { query: "x" }));
  assert.throws(() =>
    prepareInvocation(
      "docs.create",
      "user",
      { title: "x", content: "x" },
      "read",
    ),
  );
  assert.throws(() =>
    prepareInvocation("im.send_as_user", "bot", {
      "chat-id": "oc_x",
      text: "hi",
    }),
  );
});
test("text input travels by stdin and argument values cannot become flags", () => {
  const content = "@not-a-file\n--app-secret=not-an-option";
  const call = prepareInvocation("docs.create", "user", {
    title: "--help",
    content,
  });
  assert.equal(call.stdin, content);
  assert(call.argv.includes("--title=--help"));
  assert(call.argv.includes("--content=-"));
  assert(!call.argv.some((a) => a.includes(content)));
});
test("calendar writes require explicit timezone and forward time range", () => {
  assert.throws(() =>
    prepareInvocation("calendar.create", "user", {
      summary: "x",
      start: "2026-11-01T14:00:00",
      end: "2026-11-01T15:00:00",
    }),
  );
  assert.throws(() =>
    prepareInvocation("calendar.create", "user", {
      summary: "x",
      start: "2026-11-01T15:00:00Z",
      end: "2026-11-01T14:00:00Z",
    }),
  );
});
test("only official verification URLs are forwarded", () => {
  assert.equal(
    verificationLink("https://evil.test/page/cli?user_code=x"),
    undefined,
  );
  assert.equal(
    verificationLink("https://open.feishu.cn.evil.test/page/cli?user_code=x"),
    undefined,
  );
  assert.equal(
    verificationLink("URL: https://open.feishu.cn/page/cli?user_code=fixture"),
    "https://open.feishu.cn/page/cli?user_code=fixture",
  );
});
test("credential-shaped values are removed while resource tokens survive", () => {
  assert.deepEqual(
    redact({
      access_token: "synthetic",
      nested: { appSecret: "synthetic", file_token: "doc_resource" },
    }),
    {
      access_token: "[redacted]",
      nested: { appSecret: "[redacted]", file_token: "doc_resource" },
    },
  );
});
test("action manifests use Rome config enums and gate writes", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const directory of [
    "status",
    "search-commands",
    "inspect-command",
    "preview",
    "read",
    "write",
    "approve-local-write",
  ]) {
    const yaml = await readFile(
      new URL(`../src/actions/${directory}/action.yaml`, import.meta.url),
      "utf8",
    );
    assert.match(yaml, /^type: custom$/m);
    assert.match(yaml, /^speed: moderate$/m);
    if (directory === "write") assert.match(yaml, /^requiresApproval: false$/m);
    if (directory === "approve-local-write") {
      assert.match(yaml, /^requiresApproval: true$/m);
      assert.match(yaml, /^visibility: explicit$/m);
      const manifest = await readFile(new URL("../app.yaml", import.meta.url), "utf8");
      assert.match(manifest, /^  - actions\/approve-local-write$/m);
    }
  }
});
test("approval replay can regain only the explicitly approved write authority", () => {
  const replay = { actionName: "lark:approve_local_write", executionId: "fixture-execution" };
  assert.throws(() => assertGuardian(replay));
  assert.doesNotThrow(() => assertGuardian(replay, true));
  assert.throws(() =>
    assertGuardian(
      { actionName: "lark:read", executionId: "fixture-execution" },
      true,
    ),
  );
  assert.throws(() => assertGuardian({ actionName: replay.actionName }, true));
  assert.throws(() => assertGuardian({ ...replay, actionName: "lark:write" }, true));
  assert.throws(() =>
    assertGuardian(
      {
        ...replay,
        channelContext: { ...guardian.channelContext, threadType: "group" },
      },
      true,
    ),
  );
});
test("known guardian without a confirmed private thread is denied", () => {
  assert.throws(
    () =>
      assertGuardian({
        channelContext: {
          channel: "feishu",
          threadId: "unknown-thread",
          senderBondLevel: "guardian",
        },
      }),
    /private_chat_required/,
  );
});
