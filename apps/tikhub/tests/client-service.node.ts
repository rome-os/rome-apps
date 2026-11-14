import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __resetLimiter, tikhubRequest, buildUrl } from "../src/lib/client.js";
import { TikHubService, normalizeBaseUrl, normalizeEndpointPath } from "../src/lib/service.js";
import type { AppDbContext } from "@rome-os/app-runtime";
import { render } from "../src/lib/messages.js";
import { fakeFetch, loadDoc, loadPrices, memoryRepos } from "./helpers.js";

const noSleep = async () => {};
const KEY = "test_key_0123456789abcdefWXYZ";
let prefixSeq = 0;

beforeEach(() => __resetLimiter());

function makeService(handler: Parameters<typeof fakeFetch>[0], lang: "zh" | "en" = "en", shared?: ReturnType<typeof memoryRepos>) {
  const repos = shared ?? memoryRepos();
  const f = fakeFetch((url, init) => {
    if (url.pathname === "/openapi.json") return { body: loadDoc() };
    if (url.pathname === "/api/v1/tikhub/user/get_all_endpoints_info") return { body: { code: 200, data: loadPrices() } };
    return handler(url, init);
  });
  // Unique tablePrefix per test → isolated per-process schema/price memo.
  const db = { tablePrefix: `t${++prefixSeq}` } as unknown as AppDbContext;
  const svc = new TikHubService(db, f.impl, repos, lang);
  return { svc, repos, f };
}

test("authenticated requests do not retry 5xx, and send Bearer auth", async () => {
  let n = 0;
  const f = fakeFetch(() => (++n < 3 ? { status: 502, body: "bad gateway" } : { body: { code: 200, data: { ok: 1 } } }));
  const res = await tikhubRequest(
    { baseUrl: "https://api.tikhub.io", apiKey: KEY, timeoutMs: 1000, maxRetries: 3, qps: 50, fetchImpl: f.impl, sleep: noSleep },
    { method: "GET", path: "/api/v1/x", query: { a: 1, empty: "" } },
  );
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 1);
  assert.equal((f.calls[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.equal(f.calls[0]!.url, "https://api.tikhub.io/api/v1/x?a=1");
});

test("client does not retry 402 and explains it", async () => {
  const f = fakeFetch(() => ({ status: 402, body: { detail: { message: "Insufficient balance" } } }));
  const res = await tikhubRequest(
    { baseUrl: "https://api.tikhub.io", apiKey: KEY, timeoutMs: 1000, maxRetries: 3, qps: 50, fetchImpl: f.impl, sleep: noSleep },
    { method: "GET", path: "/api/v1/x" },
  );
  assert.equal(res.attempts, 1);
  assert.equal(res.error?.code, "http.402");
  assert.match(render(res.error!, "zh"), /余额不足/);
  assert.equal(render(res.error!, "en"), "Insufficient balance — top up at user.tikhub.io");
  assert.doesNotMatch(res.errorMessage!, /[\u3400-\u9fff]/);
});

test("base URL is restricted to TikHub hosts over https", () => {
  assert.equal(normalizeBaseUrl("https://api.tikhub.dev/"), "https://api.tikhub.dev");
  assert.equal(normalizeBaseUrl("https://api.tikhub.io:443"), "https://api.tikhub.io");
  assert.throws(() => normalizeBaseUrl("https://evil.example.com"));
  assert.throws(() => normalizeBaseUrl("http://api.tikhub.io"));
  for (const url of ["https://www.tikhub.io", "https://api.tikhub.io:9443", "https://synthetic-user:synthetic-pass@api.tikhub.io", "https://api.tikhub.io/ignored", "https://api.tikhub.io?redirect=1", "https://api.tikhub.io#fragment"]) assert.throws(() => normalizeBaseUrl(url));
});

test("endpoint path normalisation accepts full URLs with query", () => {
  assert.deepEqual(normalizeEndpointPath("https://api.tikhub.io/api/v1/hybrid/video_data?url=abc"), {
    path: "/api/v1/hybrid/video_data",
    query: { url: "abc" },
  });
  assert.equal(buildUrl("https://api.tikhub.io/", "/api/v1/x", { arr: [1, 2] }), "https://api.tikhub.io/api/v1/x?arr=1&arr=2");
});

test("settings: key stored, masked publicly; malformed key rejected", () => {
  const { svc } = makeService(() => ({ body: {} }));
  assert.equal(svc.publicSettings().configured, false);
  svc.updateSettings({ apiKey: `Bearer ${KEY}` });
  const pub = svc.publicSettings();
  assert.equal(pub.configured, true);
  assert.equal(pub.apiKeyMasked, "••••••••WXYZ");
  assert.equal(JSON.stringify(pub).includes(KEY), false);
  assert.equal(svc.getSettings().apiKey, KEY);
  assert.throws(() => svc.updateSettings({ apiKey: "short" }));
  svc.updateSettings({ apiKey: null });
  assert.equal(svc.publicSettings().configured, false);
});

test("call: happy path logs cost, pagination and unwrapped data", async () => {
  const { svc, repos } = makeService((url) => {
    assert.equal(url.pathname, "/api/v1/hybrid/video_data");
    assert.equal(url.searchParams.get("url"), "https://v.douyin.com/abc/");
    return { body: { code: 200, request_id: "req-1", support: "x", data: { aweme_id: "1", cursor: 0, has_more: false } } };
  });
  svc.updateSettings({ apiKey: KEY });
  const out = await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "https://v.douyin.com/abc/" } }, "agent");
  assert.equal(out.status, "ok");
  assert.equal(out.method, "GET");
  assert.equal(out.platform, "hybrid");
  assert.equal(out.costUsd, 0.001);
  assert.equal(out.requestId, "req-1");
  assert.deepEqual(out.pagination, { cursor: 0, has_more: false });
  assert.deepEqual(out.data, { aweme_id: "1", cursor: 0, has_more: false });
  const row = repos.rows.get(out.callId)!;
  assert.equal(row.status, "ok");
  assert.equal(row.source, "agent");
  assert.equal(row.costUsd, 0.001);
});

test("call: missing required params are rejected before any billable request", async () => {
  const { svc, f } = makeService(() => ({ body: {} }));
  svc.updateSettings({ apiKey: KEY });
  const out = await svc.call({ path: "/api/v1/hybrid/video_data" }, "agent");
  assert.equal(out.status, "error");
  assert.match(out.error!, /url/);
  assert.equal(f.calls.filter((c) => c.url.includes("/hybrid/")).length, 0);
});

test("call: guarded endpoints are blocked without confirm and redacted in logs", async () => {
  const { svc, repos, f } = makeService(() => ({ body: { code: 200, data: {} } }));
  svc.updateSettings({ apiKey: KEY });
  const blocked = await svc.call(
    { path: "/api/v1/douyin/web/fetch_user_collects", body: { cookie: "sessionid=SECRET", counts: 20 } },
    "agent",
  );
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.error!, /private cookie/);
  assert.doesNotMatch(blocked.error!, /[\u3400-\u9fff]/);
  assert.equal(f.calls.filter((c) => c.url.includes("fetch_user_collects")).length, 0);
  assert.equal(repos.rows.get(blocked.callId)!.requestJson!.includes("SECRET"), false);

  const ok = await svc.call(
    { path: "/api/v1/douyin/web/fetch_user_collects", body: { cookie: "sessionid=SECRET", counts: 20 }, confirm: true },
    "ui",
  );
  assert.equal(ok.status, "blocked");
  assert.equal(ok.method, "POST");
});

test("call: dry run builds the URL and spends nothing", async () => {
  const { svc, f } = makeService(() => ({ body: {} }));
  const out = await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "u" }, dryRun: true }, "agent");
  assert.equal(out.status, "dry_run");
  assert.equal(out.request!.url, "https://api.tikhub.io/api/v1/hybrid/video_data?url=u");
  assert.equal(f.calls.filter((c) => c.url.includes("/hybrid/")).length, 0);
});

test("call: without an API key a clear config error is thrown", async () => {
  const { svc } = makeService(() => ({ body: {} }));
  await assert.rejects(() => svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "u" } }, "agent"), /API key is not configured/);
});

test("stats bucket calls per local day with spend", async () => {
  const { svc } = makeService(() => ({ body: { code: 200, data: {} } }));
  svc.updateSettings({ apiKey: KEY });
  await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "u" } }, "agent");
  await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "u" } }, "ui");
  const s = svc.stats(7, 480);
  assert.equal(s.buckets.length, 7);
  assert.equal(s.totals.calls, 2);
  assert.equal(s.totals.costUsd, 0.002);
  assert.equal(s.byPlatform[0]!.platform, "hybrid");
});

test("search and inspect attach prices and safety", async () => {
  const { svc } = makeService(() => ({ body: {} }));
  const r = await svc.search({ query: "video data", platform: "hybrid" });
  assert.equal(r.items[0]!.costUsd, 0.001);
  const d = await svc.inspect({ path: "/api/v1/douyin/web/fetch_user_collects" });
  assert.ok(!("error" in d) && d.safety.sensitive && d.method === "post");
  const miss = await svc.inspect({ path: "/api/v1/douyin/nope" });
  assert.ok("error" in miss);
});

test("API key echoed back by TikHub (401) never reaches callers or logs", async () => {
  const { svc, repos } = makeService(() => ({
    status: 401,
    body: { detail: { code: 401, message: `Invalid API token, your submitted API token is ${KEY}.` } },
  }));
  svc.updateSettings({ apiKey: KEY });
  const out = await svc.call({ path: "/api/v1/hybrid/video_data", query: { url: "u" } }, "agent");
  assert.equal(out.status, "error");
  assert.equal(JSON.stringify(out).includes(KEY), false);
  assert.match(out.error!, /missing or invalid/);
  assert.equal(JSON.stringify([...repos.rows.values()]).includes(KEY), false);
});

test("service speaks exactly one language; the call log re-renders in the reader's language", async () => {
  const HAS_CJK = /[\u3400-\u9fff]/;
  const zh = makeService(() => ({ body: {} }), "zh");
  const out = await zh.svc.call({ path: "/api/v1/hybrid/video_data" }, "agent");
  assert.equal(out.error, "参数未通过本地校验：url。请求没有发出，没有扣费。");

  const blocked = await zh.svc.call({ path: "/api/v1/douyin/web/fetch_user_collects", body: { cookie: "x" } }, "agent");
  assert.match(blocked.error!, /^已拦截：此接口需要账号本人的私有 Cookie。/);
  assert.deepEqual(blocked.safety?.reasons, ["需要账号本人的私有 Cookie"]);

  // Same stored rows, read by an English-speaking service.
  const en = makeService(() => ({ body: {} }), "en", zh.repos);
  const row = en.svc.getCall(out.callId)!;
  assert.equal(row.errorMessage, "Local validation failed: url. Nothing was sent (no credits spent).");
  assert.equal(HAS_CJK.test(en.svc.getCall(blocked.callId)!.errorMessage!), false);
  assert.equal("errorJson" in row, false);

  const inspected = await zh.svc.inspect({ path: "/api/v1/hybrid/video_data" });
  assert.ok(!("error" in inspected));
  assert.equal(inspected.summary, "混合解析单一视频接口");
  const inspectedEn = await en.svc.inspect({ path: "/api/v1/hybrid/video_data" });
  assert.ok(!("error" in inspectedEn));
  assert.equal(inspectedEn.summary, "Hybrid parsing single video endpoint");
  assert.equal(HAS_CJK.test(inspectedEn.parameters.find((p) => p.name === "minimal")!.description), false);
});
