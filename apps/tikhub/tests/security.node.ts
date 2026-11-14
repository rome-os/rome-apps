import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppDbContext } from "@rome-os/app-runtime";
import { TikHubService } from "../src/lib/service.js";
import { __resetLimiter } from "../src/lib/client.js";
import { fakeFetch, loadDoc, loadPrices, memoryRepos } from "./helpers.js";

const KEY = "review_synthetic_key_not_real_1234";
let seq = 0;

function service(doc = loadDoc()) {
  __resetLimiter();
  const repos = memoryRepos();
  repos.settings.set("apiKey", KEY);
  const f = fakeFetch((url) => {
    if (url.pathname === "/openapi.json") return { body: doc };
    if (url.pathname === "/api/v1/tikhub/user/get_all_endpoints_info") return { body: { code: 200, data: [...loadPrices(), { endpoint_uri: "/api/v1/douyin/web/fetch_home_feed", endpoint_cost: 0.001 }] } };
    return { body: { code: 200, data: { mock: true } } };
  });
  return { svc: new TikHubService({ tablePrefix: `security${++seq}` } as AppDbContext, f.impl, repos), f, repos };
}

test("encoded, traversal and external paths never reach the provider", async () => {
  for (const path of [
    "/api/v1/douyin/app/v3/%72egister_device",
    "/api/v1/x/../douyin/app/v3/register_device",
    "https://attacker.invalid/api/v1/hybrid/video_data",
    "/api/v1//hybrid/video_data",
  ]) {
    const { svc, f } = service();
    await assert.rejects(() => svc.call({ path, query: { url: "mock" }, confirm: true }, "agent"));
    assert.equal(f.calls.length, 0);
  }
});

test("newly documented read-shaped operations are not automatically enabled", async () => {
  const doc = loadDoc();
  doc.paths["/api/v1/douyin/app/v3/fetch_new_unreviewed"] = { get: { summary: "New read", operationId: "fetch_new_unreviewed" } };
  const { svc, f } = service(doc);
  const out = await svc.call({ path: "/api/v1/douyin/app/v3/fetch_new_unreviewed" }, "agent");
  assert.equal(out.status, "blocked");
  assert.equal(f.calls.some((c) => c.url.includes("fetch_new_unreviewed")), false);
});

test("unknown paths and wrong methods fail closed before a data request", async () => {
  for (const args of [
    { path: "/api/v1/not_documented" },
    { path: "/api/v1/hybrid/video_data", method: "POST", query: { url: "mock" } },
  ]) {
    const { svc, f } = service();
    await assert.rejects(() => svc.call(args, "agent"));
    assert.equal(f.calls.filter((c) => !c.url.endsWith("/openapi.json")).length, 0);
  }
});

test("confirm true cannot enable private-cookie or mutating operations", async () => {
  const { svc, f } = service();
  const out = await svc.call({ path: "/api/v1/douyin/web/fetch_user_collects", body: { cookie: "synthetic-private-cookie" }, confirm: true }, "agent");
  assert.equal(out.status, "blocked");
  assert.equal(f.calls.some((c) => c.url.includes("fetch_user_collects")), false);
});

test("nested credentials and proxy inputs are blocked even on dry runs", async () => {
  for (const body of [{ nested: { cookie: "synthetic" } }, { proxy: "http://user:synthetic@proxy.invalid" }]) {
    const { svc, f, repos } = service();
    const out = await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" }, body, dryRun: true, confirm: true }, "agent");
    assert.equal(out.status, "blocked");
    assert.equal(JSON.stringify(out).includes("synthetic"), false);
    assert.equal(JSON.stringify([...repos.rows.values()]).includes("synthetic@"), false);
    assert.equal(f.calls.some((c) => c.url.includes("/hybrid/")), false);
  }
});

test("credentials near the allowed nesting limit cannot evade the private-input guard", async () => {
  const doc = loadDoc();
  const path = "/api/v1/douyin/web/fetch_home_feed";
  doc.paths[path] = { post: { summary: "Public read", requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } } } };
  let body: unknown = { cookie: "synthetic-deep-cookie" };
  for (let i = 0; i < 12; i++) body = { next: body };
  const { svc, f } = service(doc);
  const out = await svc.call({ path, body, confirm: true }, "agent");
  assert.equal(out.status, "blocked");
  assert.equal(f.calls.some((c) => c.url.includes("fetch_home_feed")), false);
});

test("null required fields and wrong types fail before a provider data request", async () => {
  for (const query of [{ url: null }, { url: "mock", minimal: "not-boolean" }]) {
    const { svc, f } = service();
    const out = await svc.call({ path: "/api/v1/hybrid/video_data", query }, "agent");
    assert.equal(out.status, "error");
    assert.equal(f.calls.some((c) => c.url.includes("/hybrid/")), false);
  }
});

test("an invalid settings patch cannot partially replace a configured synthetic key", () => {
  const { svc } = service();
  assert.throws(() => svc.updateSettings({ apiKey: "other_synthetic_key_9876", baseUrl: "https://attacker.invalid" }));
  assert.equal(svc.publicSettings().apiKeyMasked, "••••••••1234");
});


test("settings labels recognize only exact canonical addresses, never host substrings", async () => {
  const { baseUrlLabelKey } = await import("../src/web/lib/baseUrlLabel.js");
  assert.equal(baseUrlLabelKey("https://api.tikhub.io"), "settings.baseUrl.global");
  assert.equal(baseUrlLabelKey("https://api.tikhub.dev"), "settings.baseUrl.china");
  for (const value of [
    "https://api.tikhub.io.attacker.invalid", "https://attacker.invalid/api.tikhub.io",
    "https://attacker.invalid/?next=https://api.tikhub.dev", "https://api.tikhub.io@attacker.invalid",
    "http://api.tikhub.io", "https://api.tikhub.io:9443", "https://api.tikhub.dev/path", ""
  ]) assert.equal(baseUrlLabelKey(value), null);
});
