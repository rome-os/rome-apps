import { test } from "node:test";
import assert from "node:assert/strict";
import { setCurrentActionContextResolver, type CurrentActionContext, type AppActionRuntimeDeps, type ActionConfig, type RomeAppContext, type RomeAppApiRequest } from "@rome-os/app-runtime";
import { TikHubService } from "../src/lib/service.js";
import { parsePriceList } from "../src/lib/openapi.js";
import { createRepositories } from "../src/db/repositories/index.js";
import { createAction as createAccountAction } from "../src/actions/account/index.js";
import { createAction as createCallAction } from "../src/actions/call/index.js";
import { createApiHandler } from "../src/api/index.js";
import { testDb } from "./sqlite.js";
import { fakeFetch, loadDoc, loadPrices, memoryRepos } from "./helpers.js";

const KEY = "review_synthetic_key_not_real_1234";
const config = (name: string) => ({ name, description: "Synthetic test", type: "custom", complexity: "simple", speed: "fast", reliability: "high", sideEffects: "read-only" }) as ActionConfig;
let seq = 0;
function setup(handler: Parameters<typeof fakeFetch>[0], doc = loadDoc(), prices: unknown = loadPrices()) {
  const repos = memoryRepos();
  repos.settings.set("apiKey", KEY);
  repos.cache.set("openapi", JSON.stringify(doc));
  repos.cache.set("prices", JSON.stringify(parsePriceList(prices)));
  const f = fakeFetch(handler);
  return { svc: new TikHubService({ tablePrefix: "ops" + ++seq } as never, f.impl, repos), repos, f };
}

test("unknown outcomes remain unknown in the log and aggregate, not zero spend", async () => {
  const { svc, f } = setup(() => new Error("response lost after synthetic commit"));
  const out = await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" } }, "agent");
  assert.equal(out.status, "error");
  assert.equal(out.outcomeUnknown, true);
  assert.equal(out.costUsd, null);
  assert.equal(f.calls.length, 1);
  assert.equal(svc.getCall(out.callId)?.status, "outcome_unknown");
  assert.equal(svc.stats(7, 0).totals.unknownCosts, 1);
});

test("HTTP 200 business failure is not success, but keeps a base fee estimate", async () => {
  const { svc } = setup(() => ({ body: { code: 500, data: null } }));
  const out = await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" } }, "agent");
  assert.equal(out.status, "error");
  assert.equal(out.costUsd, 0.001);
  assert.equal(out.costBasis, "base_estimate");
});

test("unknown prices never silently become zero or authorize a data request", async () => {
  const { svc, f } = setup(() => { throw new Error("data request must not be sent"); }, loadDoc(), []);
  await assert.rejects(() => svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" } }, "agent"));
  assert.equal(f.calls.some((c) => c.url.includes("/hybrid/")), false);
  assert.equal(parsePriceList([{ endpoint_uri: "/mock", endpoint_cost: null }])["/mock"]?.costUsd, null);
});

test("legacy previews and errors are projected safely without rewriting stored rows", () => {
  const { svc, repos } = setup(() => ({ body: {} }));
  repos.calls.insert({ id: "legacy", createdAt: new Date(), source: "agent", method: "GET", path: "/api/v1/mock", status: "error", requestJson: JSON.stringify({ proxy: "http://review-user:synthetic-password@proxy.invalid" }), responsePreview: JSON.stringify({ cookie: "synthetic-private-cookie", page_token: "public-cursor" }), errorMessage: "old transport " + KEY });
  const row = svc.getCall("legacy")!;
  const text = JSON.stringify(row);
  for (const secret of [KEY, "synthetic-password", "synthetic-private-cookie"]) assert.equal(text.includes(secret), false);
  assert.equal(text.includes("public-cursor"), true);
  assert.equal(repos.rows.get("legacy")?.errorMessage?.includes(KEY), true);
});

test("size and depth bounds reject input before any provider work", async () => {
  const { svc, f } = setup(() => ({ body: {} }));
  await assert.rejects(() => svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "x".repeat(65537) } }, "agent"));
  let nested: unknown = "mock";
  for (let i = 0; i < 25; i++) nested = { next: nested };
  await assert.rejects(() => svc.call({ path: "/api/v1/hybrid/video_data", body: nested }, "agent"));
  assert.equal(f.calls.length, 0);
});

test("locally rejected inputs are not retained as request parameters", async () => {
  const { svc, repos, f } = setup(() => ({ body: {} }));
  const out = await svc.call({ path: "/api/v1/hybrid/video_data", body: { value: "synthetic-private-unlabelled" } }, "agent");
  assert.equal(out.status, "error");
  assert.equal(JSON.stringify([...repos.rows.values()]).includes("synthetic-private-unlabelled"), false);
  assert.equal(f.calls.length, 0);
});

test("stale or unavailable schema cannot authorize a data request", async () => {
  for (const cached of [false, true]) {
    const repos = memoryRepos();
    repos.settings.set("apiKey", KEY);
    if (cached) repos.cache.get = () => ({ value: JSON.stringify(loadDoc()), fetchedAt: new Date(0) });
    const f = fakeFetch(() => ({ body: { not_a_schema: true } }));
    const svc = new TikHubService({ tablePrefix: "stale" + ++seq } as never, f.impl, repos);
    await assert.rejects(() => svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" } }, "agent"));
    assert.equal(f.calls.some((c) => c.url.includes("/hybrid/")), false);
  }
});

test("real action factories reject untrusted actors before app DB access", async () => {
  let touchedDb = false;
  const ctx = { get db() { touchedDb = true; throw new Error("must not read DB"); }, repositories: { settings: { get: async () => "zh" } } } as unknown as RomeAppContext;
  for (const actorKind of ["visitor", "anonymous", undefined]) {
    setCurrentActionContextResolver(() => ({ actorKind }) as unknown as CurrentActionContext);
    try {
      const deps = { appContext: ctx } as AppActionRuntimeDeps;
      assert.equal((await createAccountAction(config("account"), deps).execute({})).status, "error");
      assert.equal((await createCallAction(config("call"), deps).execute({ path: "/api/v1/hybrid/video_data" })).status, "error");
      assert.equal(touchedDb, false);
    } finally { setCurrentActionContextResolver(null); }
  }
});

test("guardian account factory returns only bounded metadata, and HTTP rejects spoofed callers", async () => {
  const database = testDb();
  const ctx = { app: { id: "tikhub", version: "0.1.0" }, db: database.db, repositories: { settings: { get: async () => "en" } } } as unknown as RomeAppContext;
  const repos = createRepositories(database.db);
  repos.settings.set("apiKey", KEY);
  const original = globalThis.fetch;
  const f = fakeFetch((url) => url.pathname.endsWith("get_user_info") ? { body: { user_data: { email: "review@example.invalid", balance: 1, password: "synthetic-password", extra: "not-returned" }, api_key_data: { api_key_name: "synthetic-name", api_key_status: 1 } } } : { body: { code: 200, data: [] } });
  globalThis.fetch = f.impl;
  setCurrentActionContextResolver(() => ({ actorKind: "guardian", channelContext: { threadType: "private" } }) as unknown as CurrentActionContext);
  try {
    const out = await createAccountAction(config("account"), { appContext: ctx } as AppActionRuntimeDeps).execute({});
    assert.equal(out.status, "ok");
    assert.equal(JSON.stringify(out).includes("synthetic-password"), false);
    assert.equal(JSON.stringify(out).includes("not-returned"), false);
    assert.equal(JSON.stringify(out).includes(KEY), false);
    const api = createApiHandler(ctx);
    for (const caller of [{ kind: "visitor" }, { kind: "anonymous" }]) {
      const res = await api.handle({ caller, path: ["account"], method: "GET", headers: { "x-rome-caller-kind": "guardian" }, query: new URLSearchParams() } as unknown as RomeAppApiRequest);
      assert.equal(res.status, 403);
    }
    const large = await api.handle({ caller: { kind: "guardian" }, path: ["call"], method: "POST", headers: {}, query: new URLSearchParams(), body: new Uint8Array(65537) } as RomeAppApiRequest);
    assert.equal(large.status, 413);
  } finally { globalThis.fetch = original; setCurrentActionContextResolver(null); database.close(); }
});
