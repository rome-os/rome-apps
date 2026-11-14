import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest } from "../src/lib/validation.js";
import { truncateForAgent } from "../src/lib/shape.js";
import type { OpenApiDoc } from "../src/lib/openapi.js";

function bodyDoc(schema: unknown): OpenApiDoc {
  return { paths: { "/mock": { post: { requestBody: { required: true, content: { "application/json": { schema } } } } } } };
}

test("nested JSON constraints, nullable required values and boolean schemas are checked", () => {
  const doc = bodyDoc({ type: "object", required: ["value"], additionalProperties: false, properties: { value: { anyOf: [{ type: "integer", minimum: 1, maximum: 3 }, { type: "null" }] } } });
  assert.deepEqual(validateRequest(doc, "post", "/mock", {}, {}, { value: null }), []);
  assert.deepEqual(validateRequest(doc, "post", "/mock", {}, {}, { value: 2 }), []);
  for (const value of [{ value: "2" }, { value: 4 }, { value: 1, extra: true }, {}]) assert.ok(validateRequest(doc, "post", "/mock", {}, {}, value).length > 0);
  assert.ok(validateRequest(bodyDoc(false), "post", "/mock", {}, {}, {}).length > 0);
});

test("unsafe provider regular expressions and unsupported validation keywords fail closed", () => {
  for (const schema of [{ type: "string", pattern: "^(a+)+$" }, { type: "object", dependentRequired: { a: ["b"] } }]) {
    assert.ok(validateRequest(bodyDoc(schema), "post", "/mock", {}, {}, "a".repeat(1000) + "!").length > 0);
  }
});

test("query scalar coercion preserves validation without accepting wrong types", () => {
  const doc = { paths: { "/mock": { get: { parameters: [{ in: "query", name: "count", required: true, schema: { type: "integer", minimum: 1, maximum: 10 } }] } } } } as OpenApiDoc;
  assert.deepEqual(validateRequest(doc, "get", "/mock", { count: "3" }, {}, undefined), []);
  for (const count of [null, "nope", "3.1", "3.", "11"]) assert.ok(validateRequest(doc, "get", "/mock", { count }, {}, undefined).length > 0);
});

test("query arrays validate their actual repeated-key representation, not a JSON string", () => {
  const doc = { paths: { "/mock": { get: { parameters: [{ in: "query", name: "ids", required: true, schema: { type: "array", items: { type: "string" } } }] } } } } as OpenApiDoc;
  assert.deepEqual(validateRequest(doc, "get", "/mock", { ids: ["1", "2"] }, {}, undefined), []);
  assert.ok(validateRequest(doc, "get", "/mock", { ids: '["1","2"]' }, {}, undefined).length > 0);
});

test("even wide escaped JSON truncation stays inside the serialized character budget", () => {
  const data = Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['"'.repeat(20) + i, { value: '\\'.repeat(200) }]));
  const out = truncateForAgent(data, 2000);
  assert.equal(out.truncated, true);
  assert.ok(JSON.stringify(out.value).length <= 2000);
});
