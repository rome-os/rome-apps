import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { uiHarness } from "./ui-harness.js";
const A = "/api/v1/hybrid/video_data", B = "/api/v1/synthetic/other_read";
const result = (path: string) => ({ status: "ok", path, callId: "synthetic-" + path, warnings: [], data: { path } });
async function start(h: ReturnType<typeof uiHarness>, path: string) {
  h.render(path); await h.flush(); const tree = h.render(path);
  const send = h.find(tree, n => n.type === "Button" && JSON.stringify(n.props.children).includes("endpoint.send"));
  assert.ok(send && !send.props.disabled); send.props.onClick();
  return send;
}
for (const response of ["success", "failure"] as const) test(`R3: A late ${response} never attaches to B`, async () => {
  const h = uiHarness(); await start(h, A); h.render(A); h.render(B); await h.flush(); h.render(B);
  if (response === "success") h.calls[0]!.resolve(result(A)); else h.calls[0]!.reject(new Error("synthetic failure from A"));
  await h.flush(); const tree = h.render(B);
  assert.equal(h.find(tree, n => typeof n.type === "function" && n.type.name === "OutcomeView"), null);
  assert.equal(h.find(tree, n => n.type === "ErrorAlert" && String(n.props.error).includes("synthetic failure from A")), null);
  assert.equal(h.calls.length, 1, "no automatic resend");
});
test("R3: same endpoint completion works; duplicate click before render sends once", async () => {
  const h = uiHarness(); const send = await start(h, A); send.props.onClick(); assert.equal(h.calls.length, 1);
  h.calls[0]!.resolve(result(A)); await h.flush();
  assert.equal(h.find(h.render(A), n => typeof n.type === "function" && n.type.name === "OutcomeView")?.props.outcome.path, A);
});
test("R3: old A failure cannot clear a newer B request or overwrite B success", async () => {
  const h = uiHarness(); await start(h, A); await start(h, B); assert.equal(h.calls.length, 2);
  h.calls[0]!.reject(new Error("synthetic A failure")); await h.flush();
  let tree = h.render(B);
  assert.ok(h.find(tree, n => n.type === "Button" && JSON.stringify(n.props.children).includes("endpoint.sending"))?.props.disabled);
  h.calls[1]!.resolve(result(B)); await h.flush(); tree = h.render(B);
  assert.equal(h.find(tree, n => typeof n.type === "function" && n.type.name === "OutcomeView")?.props.outcome.path, B);
});
test("R3: leaving and returning to A cannot resurrect its earlier response", async () => {
  const h = uiHarness(); await start(h, A); h.render(B); await h.flush(); h.render(B); h.render(A); await h.flush(); h.render(A);
  h.calls[0]!.resolve(result(A)); await h.flush();
  assert.equal(h.find(h.render(A), n => typeof n.type === "function" && n.type.name === "OutcomeView"), null);
});
test("R3: unmount suppresses completion and does not replay the sent request", async () => {
  const h = uiHarness(); await start(h, A); h.unmount(); const before = h.writes(); h.calls[0]!.resolve(result(A)); await h.flush();
  assert.equal(h.writes(), before, "no write after unmount");
  assert.equal(h.calls.length, 1);
  assert.match(readFileSync(resolve("src/web/App.tsx"), "utf8"), /EndpointDetail key=\{`\$\{route.method\}:\$\{route.path\}`\}/);
});
for (const [label, value, expected] of [
  ["business failure with fee", { status: "error", costUsd: .001, costBasis: "base_estimate" }, "cost.baseEstimate"],
  ["unknown result", { status: "error", outcomeUnknown: true, costUsd: null }, "cost.unknown"],
  ["legacy unknown", { status: "error", costUsd: null }, "cost.unknown"],
  ["zero confirmed", { status: "error", costUsd: 0, costBasis: "not_billed" }, "cost.notBilled"],
  ["dry-run prospective quote", { status: "dry_run", costUsd: .001 }, "cost.notBilled"],
] as const) test(`R4: UI fee meaning is independent of success: ${label}`, () => {
  const h = uiHarness();
  const view = h.renderOutcome({ outcome: { ...value, callId: "synthetic", warnings: [], httpStatus: 200, error: "synthetic" } });
  const text = h.text(view); assert.ok(text.includes(expected));
  if (expected === "cost.baseEstimate") assert.ok(text.includes("$0.001"));
  const cost = h.load(resolve("src/web/components/CostValue.tsx")).CostValue;
  assert.ok(h.text(cost({ value })).includes(expected));
});
test("R4: list and detail both use the same cost renderer without status gating", () => {
  const source = readFileSync(resolve("src/web/components/Calls.tsx"), "utf8");
  assert.match(source, /<CostValue value=\{c\}/); assert.match(source, /<CostValue key="cost" value=\{row\}/);
});

test("R4: a rejected app HTTP response is not reported as definitely unsent or free", async () => {
  const h = uiHarness(); await start(h, A); h.calls[0]!.reject(new Error("synthetic lost app response")); await h.flush();
  const tree = h.render(A);
  const alert = h.find(tree, n => n.type === "ErrorAlert" && n.props.title === "endpoint.unconfirmed");
  assert.ok(alert);
  assert.ok(String(alert.props.error).includes("cost.unknown"));
  assert.equal(h.calls.length, 1);
});
