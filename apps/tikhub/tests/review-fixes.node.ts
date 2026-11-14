/** PR42 counterexamples use synthetic data, in-memory storage and fake HTTP only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { previewText } from "../src/lib/shape.js";
import { TikHubService } from "../src/lib/service.js";
import { fakeFetch, memoryRepos, loadDoc, loadPrices } from "./helpers.js";
import { parsePriceList } from "../src/lib/openapi.js";
import { uiHarness } from "./ui-harness.js";

import { dispatchWhenReady } from "../src/lib/dispatch.js";
import { createRepositories } from "../src/db/repositories/index.js";
import { testDb } from "./sqlite.js";
import { tikhubRequest } from "../src/lib/client.js";

let sequence = 0;
function setup() {
  const repos = memoryRepos();
  repos.settings.set("apiKey", "synthetic_review_key_never_real_1234");
  const doc = loadDoc();
  doc.paths["/api/v1/tikhub/user/get_user_daily_usage"] = { get: { tags: ["TikHub-User-API"] } };
  repos.cache.set("openapi", JSON.stringify(doc));
  repos.cache.set("prices", JSON.stringify({ ...parsePriceList(loadPrices()), "/api/v1/tikhub/user/get_user_daily_usage": { costUsd: 0 } }));
  const http = fakeFetch(url => ({ body: url.pathname.endsWith("get_user_daily_usage") ? { code: 200, data: [] }
    : { code: 200, user_data: { email: "synthetic@example.invalid", balance: 1, synthetic_extra: "do-not-retain" }, api_key_data: {} } }));
  const service = new TikHubService({ tablePrefix: `reviewfix_${++sequence}` } as any, http.impl, repos);
  return { repos, http, service };
}
for (const [name, data] of [
  ["ordinary string", "synthetic string"],
  ["large object", { rows: Array.from({ length: 25 }, () => ({ title: "x".repeat(1000) })) }],
  ["dense object", Object.fromEntries(Array.from({ length: 1450 }, (_, i) => ["k" + i, 0]))],
  ["escaped string", '"\\\n'.repeat(20_000)],
  ["null", null], ["undefined", undefined],
] as const) test(`review: persisted preview stays valid bounded JSON: ${name}`, () => {
  const text = previewText(data);
  assert.ok(text.length <= 16_000);
  assert.doesNotThrow(() => JSON.parse(text));
});
for (const path of ["get_user_info", "get_user_daily_usage"]) test(`review: generic account route ${path} is blocked even with confirm or dryRun`, async () => {
  const { service, http, repos } = setup();
  for (const extra of [{}, { dryRun: true }, { confirm: true }]) {
    const out = await service.call({ path: "/api/v1/tikhub/user/" + path, ...extra }, "agent");
    assert.equal(out.status, "blocked");
  }
  assert.equal(http.calls.length, 0);
  assert.ok([...repos.rows.values()].every(row => !row.responsePreview));
});
test("review: dedicated free account keeps its projection and both reads", async () => {
  const { service, http } = setup();
  const out = await service.account();
  assert.equal(out.ok, true);
  assert.equal(http.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(out), /do-not-retain/);
});
test("review: credit-consuming actions are write; free account/discovery remain read-only", () => {
  for (const action of ["call", "parse-video"]) assert.match(readFileSync(`src/actions/${action}/action.yaml`, "utf8"), /^sideEffects: write$/m);
  for (const action of ["account", "search-endpoints", "inspect-endpoint"]) assert.match(readFileSync(`src/actions/${action}/action.yaml`, "utf8"), /^sideEffects: read-only$/m);
});
test("review: explorer reaches all 250 items with bounded offset pages", async () => {
  const requests: URLSearchParams[] = [];
  const items = Array.from({ length: 250 }, (_, i) => ({ method: "get", path: `/api/v1/douyin/synthetic_${i}`, summary: String(i), tags: [] }));
  const h = uiHarness({ apiGet: async route => {
    if (route === "catalog") return { platforms: [{ id: "douyin", operations: 250 }] };
    const params = new URLSearchParams(route.split("?")[1]); requests.push(params);
    const offset = Number(params.get("offset") ?? 0), limit = Math.min(200, Number(params.get("limit")));
    return { total: 250, items: items.slice(offset, offset + limit), platform: "douyin", schemaVersion: "synthetic" };
  } });
  const { Explorer } = h.load(resolve("src/web/components/Explorer.tsx"));
  const render = () => h.renderComponent(Explorer, { platform: "douyin" });
  try {
    render(); await h.flush();
    for (let i = 0; i < 4; i++) {
      const more = h.find(render(), n => n.type === "Button");
      assert.ok(more && !more.props.disabled); more.props.onClick(); render(); await h.flush();
    }
    const tree = render();
    assert.ok(h.text(tree).includes("synthetic_249"));
    assert.equal(h.find(tree, n => n.type === "Button"), null);
    assert.deepEqual(requests.map(p => Number(p.get("offset") ?? 0)), [0, 50, 100, 150, 200]);
    assert.ok(requests.every(p => p.get("limit") === "50"));
  } finally { h.unmount(); }
});

test("review: log read-back preserves bounded JSON and still withholds unsafe legacy rows", async () => {
  const { repos, service } = setup();
  const out = await service.call({ path: "/api/v1/hybrid/video_data", query: { url: "synthetic" } }, "agent");
  for (const value of ["synthetic string", { rows: Array.from({ length: 25 }, () => "x".repeat(1000)) }]) {
    repos.calls.update(out.callId, { responsePreview: previewText(value) });
    const row = service.getCall(out.callId)!;
    assert.doesNotThrow(() => JSON.parse(row.responsePreview!));
  }
  repos.calls.update(out.callId, { responsePreview: '{"legacy":' });
  assert.match(service.getCall(out.callId)!.responsePreview!, /withheld/);
  repos.calls.update(out.callId, { responsePreview: JSON.stringify({ text: "synthetic_review_key_never_real_1234" }) });
  assert.doesNotMatch(service.getCall(out.callId)!.responsePreview!, /synthetic_review_key_never_real_1234/);
});

// Injected clock tests admission, overdue timers and pre-send failure without
// wall-clock thresholds, HTTP, busy-loop delays or sleeping for real seconds.
test("review: an overdue waiter rechecks admission instead of dispatching beside a new request", async () => {
  const db = testDb();
  let now = Date.now() + 1_000_000;
  const base = now, sends: number[] = [];
  const pending: Array<{ ms: number; resolve: () => void }> = [];
  const clock = { now: () => now, sleep: (ms: number) => new Promise<void>(resolve => pending.push({ ms, resolve })) };
  const cache = createRepositories(db.db).cache;
  const dispatch = () => dispatchWhenReady(() => cache.tryAcquireRequestSlot("/synthetic", 10, 1, now), async () => { sends.push(now - base); }, clock);
  try {
    await dispatch();
    const late = dispatch();
    assert.equal(pending[0]!.ms, 1000);
    now += 2500;
    await dispatch();
    pending.shift()!.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(sends, [0, 2500]);
    assert.equal(pending[0]!.ms, 1000);
    now += 1000; pending.shift()!.resolve(); await late;
    assert.deepEqual(sends, [0, 2500, 3500]);
  } finally { db.close(); }
});
test("review: pre-send queue failure releases capacity and never fetches or retries", async () => {
  const http = fakeFetch(() => ({ body: {} }));
  let released = 0;
  await assert.rejects(tikhubRequest({ baseUrl: "https://api.tikhub.io", apiKey: "synthetic_key_not_real", timeoutMs: 5000, maxRetries: 5, qps: 10, fetchImpl: http.impl,
    beginRequest: () => () => { released++; },
    dispatch: send => dispatchWhenReady(() => 30_001, send, { now: () => 0, sleep: async () => { throw new Error("must not sleep"); } }),
  }, { method: "GET", path: "/api/v1/synthetic" }), /request queue full/);
  assert.equal(http.calls.length, 0); assert.equal(released, 1);
});
test("review: a sent lost response remains unknown, single-attempt and releases capacity", async () => {
  const http = fakeFetch(() => new Error("synthetic lost response"));
  let released = 0, admits = 0;
  const out = await tikhubRequest({ baseUrl: "https://api.tikhub.io", apiKey: "synthetic_key_not_real", timeoutMs: 5000, maxRetries: 5, qps: 10, fetchImpl: http.impl,
    beginRequest: () => () => { released++; }, dispatch: send => { admits++; return send(); },
  }, { method: "GET", path: "/api/v1/synthetic" });
  assert.equal(out.outcomeUnknown, true); assert.equal(out.attempts, 1);
  assert.equal(http.calls.length, 1); assert.equal(admits, 1); assert.equal(released, 1);
});
test("review: concurrency capacity spans a slow response body, not only headers", async () => {
  let releaseBody!: () => void, released = 0;
  const stream = new ReadableStream({ start(controller) { releaseBody = () => { controller.enqueue(new TextEncoder().encode('{"code":200}')); controller.close(); }; } });
  const call = tikhubRequest({ baseUrl: "https://api.tikhub.io", apiKey: "synthetic_key_not_real", timeoutMs: 5000, maxRetries: 0, qps: 10,
    fetchImpl: (async () => new Response(stream)) as typeof fetch,
    beginRequest: () => () => { released++; }, dispatch: send => send(),
  }, { method: "GET", path: "/api/v1/synthetic" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(released, 0); releaseBody(); assert.equal((await call).ok, true); assert.equal(released, 1);
});

for (const completion of ["success", "failure"] as const) test(`review: old catalog ${completion} cannot overwrite a new query/platform or resurrect after return`, async () => {
  const pending: Array<{ route: string; resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  const h = uiHarness({ apiGet: route => new Promise((resolve, reject) => pending.push({ route, resolve, reject })) });
  const { useEndpointSearch } = h.load(resolve("src/web/hooks/useEndpointSearch.ts"));
  const render = (platform: string, query: string) => h.renderComponent(() => useEndpointSearch(platform, query), {});
  const page = (platform: string, name: string) => ({ total: 1, platform, items: [{ method: "get", path: name }] });
  render("douyin", "old"); render("tiktok", "new"); render("douyin", "old");
  if (completion === "success") pending[0]!.resolve(page("douyin", "stale")); else pending[0]!.reject(new Error("stale failure"));
  await h.flush();
  assert.equal(render("douyin", "old").result, null);
  pending[2]!.resolve(page("douyin", "fresh")); await h.flush();
  assert.equal(render("douyin", "old").result.items[0].path, "fresh");
  h.unmount(); const writes = h.writes(); pending[1]!.resolve(page("tiktok", "stale")); await h.flush();
  assert.equal(h.writes(), writes);
});
test("review: catalog load-more double-click sends one page; a failed page can retry at the same offset", async () => {
  const pending: Array<{ route: string; resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  const h = uiHarness({ apiGet: route => new Promise((resolve, reject) => pending.push({ route, resolve, reject })) });
  const { useEndpointSearch } = h.load(resolve("src/web/hooks/useEndpointSearch.ts"));
  const render = () => h.renderComponent(() => useEndpointSearch("douyin", "synthetic"), {});
  render(); pending[0]!.resolve({ total: 51, items: Array.from({ length: 50 }, (_, i) => ({ method: "get", path: String(i) })) }); await h.flush();
  const state = render(); state.loadMore(); state.loadMore(); assert.equal(pending.length, 2);
  assert.equal(new URLSearchParams(pending[1]!.route.split("?")[1]).get("offset"), "50");
  pending[1]!.reject(new Error("synthetic failure")); await h.flush(); render().loadMore(); assert.equal(pending.length, 3);
  assert.equal(new URLSearchParams(pending[2]!.route.split("?")[1]).get("offset"), "50");
  pending[2]!.resolve({ total: 51, items: [{ method: "get", path: "50" }] }); await h.flush();
  assert.equal(render().result.items.length, 51); assert.equal(render().hasMore, false); h.unmount();
});
test("review: DB admission enforces global and per-endpoint intervals without future reservations", () => {
  const db = testDb();
  try {
    const cache = createRepositories(db.db).cache, now = Date.now() + 1_000_000;
    assert.equal(cache.tryAcquireRequestSlot("/a", 2, 1, now), 0);
    assert.equal(cache.tryAcquireRequestSlot("/b", 2, 10, now), 500);
    assert.equal(cache.tryAcquireRequestSlot("/a", 2, 1, now), 1000);
    assert.equal(cache.tryAcquireRequestSlot("/b", 2, 10, now + 500), 0);
    assert.equal(cache.tryAcquireRequestSlot("/a", 2, 1, now + 1000), 0);
    assert.equal(cache.tryAcquireRequestSlot("/slow", 10, .1, now + 1500), 0);
    assert.equal(cache.tryAcquireRequestSlot("/slow", 10, .1, now + 1600), 9900);
  } finally { db.close(); }
});
test("review: a frozen or backwards queue clock cannot loop indefinitely", async () => {
  let waits = 0;
  await assert.rejects(dispatchWhenReady(() => 1, async () => { throw new Error("must not send"); }, { now: () => 0, sleep: async () => { waits++; } }), /request queue full/);
  assert.ok(waits <= 513);
});
test("review: SQLite log read cap does not turn new dense/escaped previews into invalid JSON", () => {
  const db = testDb();
  try {
    const repo = createRepositories(db.db).calls;
    const dense = Object.fromEntries(Array.from({ length: 1450 }, (_, i) => ["k" + i, '"\\\n']));
    repo.insert({ id: "synthetic-preview", createdAt: new Date(), source: "agent", method: "GET", path: "/api/v1/synthetic", status: "ok", responsePreview: previewText(dense), requestJson: previewText({ query: { text: '"\\'.repeat(20_000) } }) });
    const row = repo.byId("synthetic-preview")!;
    assert.ok(row.responsePreview!.length <= 16_000);
    assert.doesNotThrow(() => JSON.parse(row.responsePreview!));
    assert.doesNotThrow(() => JSON.parse(row.requestJson!));
  } finally { db.close(); }
});
test("review: service records rejected dispatch as zero-attempt not-billed local failure", async () => {
  const { repos, service, http } = setup();
  repos.cache.tryAcquireRequestSlot = () => 30_001;
  await assert.rejects(service.call({ path: "/api/v1/hybrid/video_data", query: { url: "synthetic" } }, "agent"));
  assert.equal(http.calls.length, 0);
  const row = [...repos.rows.values()][0]!;
  assert.equal(row.status, "error"); assert.equal(row.attempts, 0); assert.equal(row.costUsd, 0);
});
test("review: a wake-up beyond the queue deadline cannot send or renew admission", async () => {
  let now = 0, checks = 0, sends = 0;
  await assert.rejects(dispatchWhenReady(() => { checks++; return 1000; }, async () => { sends++; }, { now: () => now, sleep: async () => { now += 31_000; } }), /request queue full/);
  assert.equal(checks, 1); assert.equal(sends, 0);
  now = 0;
  await assert.rejects(dispatchWhenReady(() => { now = 31_000; return 0; }, async () => { sends++; }, { now: () => now, sleep: async () => {} }), /request queue full/);
  assert.equal(sends, 0, "a slow SQLite lock must not dispatch after the deadline");
});
