import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedPagination, shapeCallPayload } from "../src/lib/shape.js";
import { costKind } from "../src/lib/cost.js";
test("R2: long cursors are omitted rather than shortened into usable-looking tokens", () => {
  const p = boundedPagination({ cursor: "x".repeat(250000), has_more: true, log_pb: { arbitrary: "x".repeat(250000) } }, 500);
  assert.equal(p.omitted, true); assert.deepEqual(p.value, { has_more: true });
  assert.deepEqual(boundedPagination({ log_pb: { impr_id: "synthetic-id", ignored: { large: "x".repeat(5000) } } }).value, { log_pb: "synthetic-id" });
});
test("R2: escaped strings, wide data and pagination share the serialized budget", () => {
  for (const max of [2000, 30000, 200000]) for (const data of [
    { cursor: '"\\'.repeat(200000), records: ["x".repeat(100000)] },
    Object.fromEntries(Array.from({ length: 3000 }, (_, i) => ["node" + i, { cursor: "synthetic-" + i }])),
    { cursor: "ordinary-cursor", rows: Array.from({ length: 1000 }, () => ({ text: '"\\'.repeat(100) })) },
  ]) {
    const out = shapeCallPayload(data, max);
    assert.ok(JSON.stringify({ data: out.value, pagination: out.pagination }).length <= max);
  }
});
test("R2: scalar hints survive with honest omission flags for unsupported containers", () => {
  const p = boundedPagination({ cursor: 20, has_more: false, log_pb: { nested: { arbitrary: "not-a-cursor" } } });
  assert.deepEqual(p.value, { cursor: 20, has_more: false }); assert.equal(p.omitted, true);
});
test("R4: unknown spend takes precedence; failures retain estimates; dry-run quotes are not spend", () => {
  assert.equal(costKind({ status: "error", costUsd: .001, costBasis: "base_estimate" }), "base_estimate");
  assert.equal(costKind({ status: "error", costUsd: 0, outcomeUnknown: true }), "unknown");
  assert.equal(costKind({ status: "outcome_unknown", costUsd: 0 }), "unknown");
  assert.equal(costKind({ status: "pending", costUsd: 0 }), "unknown");
  assert.equal(costKind({ status: "error", costUsd: null }), "unknown");
  assert.equal(costKind({ status: "dry_run", costUsd: .25 }), "not_billed");
  assert.equal(costKind({ status: "error", costUsd: 0, costBasis: "not_billed" }), "not_billed");
});
