import { test } from "vitest";
import assert from "node:assert/strict";
import { checkDocumentAccess } from "../src/lib/access-probe.js";
import type { LarkService } from "../src/lib/service.js";
const input = {
  connectionId: "fixture-A",
  identity: "bot" as const,
  doc: "https://example.feishu.cn/docx/fixture",
};
test("access probe confirms one read without returning document content or implying write access", async () => {
  let called: unknown;
  const service = {
    invoke: async (value: unknown, risk: unknown) => {
      called = { value, risk };
      return { ok: true, data: { body: "SYNTHETIC_DOCUMENT_BODY" } };
    },
  } as unknown as LarkService;
  const result = await checkDocumentAccess(service, input);
  assert.equal(result.access, "confirmed");
  assert(!JSON.stringify(result).includes("SYNTHETIC_DOCUMENT_BODY"));
  assert.deepEqual(called, {
    value: {
      connectionId: input.connectionId,
      identity: "bot",
      command: "docs.fetch",
      parameters: { doc: input.doc, scope: "full" },
    },
    risk: "read",
  });
});
test("only explicit permission failures are denied; transport and not-found errors stay unknown", async () => {
  for (const [error, access] of [
    ["api.permission_denied", "denied"],
    ["api.not_found", "unknown"],
    ["timeout", "unknown"],
  ]) {
    const service = {
      invoke: async () => ({ ok: false, error }),
    } as unknown as LarkService;
    assert.equal((await checkDocumentAccess(service, input)).access, access);
  }
});
