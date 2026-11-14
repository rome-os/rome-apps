import { test } from "node:test";
import assert from "node:assert/strict";
import { createRepositories } from "../src/db/repositories/index.js";
import { testDb } from "./sqlite.js";
import { TikHubService } from "../src/lib/service.js";
import { fakeFetch, loadDoc } from "./helpers.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("invalid limits cannot remove the call-list cap, and offset reaches later rows", () => {
  const ctx = testDb();
  try {
    const repos = createRepositories(ctx.db);
    for (let i = 0; i < 205; i++) repos.calls.insert({ id: String(i), createdAt: new Date(), source: "agent", method: "GET", path: "/api/v1/mock", status: "ok" });
    assert.ok(repos.calls.list({ limit: -1 }).items.length <= 200);
    assert.ok(repos.calls.list({ limit: NaN }).items.length <= 200);
    assert.equal(repos.calls.list({ limit: 50, offset: 200 }).items.length, 5);
  } finally { ctx.close(); }
});

test("concurrency leases are bounded and an expired owner's release cannot steal a new lease", () => {
  const ctx = testDb();
  try {
    const cache = createRepositories(ctx.db).cache;
    const start = Date.now() + 10_000;
    const leases = Array.from({ length: 4 }, () => cache.acquireRequestLease(1000, start));
    assert.throws(() => cache.acquireRequestLease(1000, start));
    const replacement = cache.acquireRequestLease(1000, start + 1001);
    cache.releaseRequestLease(leases[0]!);
    const next = Array.from({ length: 3 }, () => cache.acquireRequestLease(1000, start + 1001));
    assert.throws(() => cache.acquireRequestLease(1000, start + 1001));
    cache.releaseRequestLease(replacement);
    assert.ok(cache.acquireRequestLease(1000, start + 1001));
    assert.equal(next.length, 3);
  } finally { ctx.close(); }
});

test("two DB connections enforce the provider endpoint rate together", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tikhub-synthetic-"));
  const first = testDb(join(dir, "test.sqlite"));
  const second = testDb(join(dir, "test.sqlite"), false);
  let now = Date.now() + 1_000_000;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const sentAt: number[] = [];
  const f = fakeFetch(() => { sentAt.push(now); return { body: { code: 200, data: {} } }; });
  try {
    const repos = createRepositories(first.db);
    repos.settings.set("apiKey", "review_synthetic_key_not_real_1234");
    repos.cache.set("openapi", JSON.stringify(loadDoc()));
    repos.cache.set("prices", JSON.stringify({ "/api/v1/hybrid/video_data": { costUsd: 0.001, rateLimit: "1/second" } }));
    const other = createRepositories(second.db);
    // Simulate slow lease/setup work. It must happen BEFORE dispatch admission.
    const acquire = repos.cache.acquireRequestLease.bind(repos.cache);
    repos.cache.acquireRequestLease = (...args) => { const lease = acquire(...args); now += 200; return lease; };
    const a = new TikHubService(first.db, f.impl, repos, "en", clock);
    const b = new TikHubService(second.db, f.impl, other, "en", clock);
    const results = await Promise.all([a.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" } }, "agent"), b.call({ path: "/api/v1/hybrid/video_data", query: { url: "mock" } }, "ui")]);
    assert.equal(results.every((r) => r.status === "ok"), true);
    assert.equal(sentAt.length, 2);
    assert.ok(sentAt[1]! - sentAt[0]! >= 1000);
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true }); }
});

test("independent Node processes atomically admit only one dispatch in one isolated SQLite file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tikhub-worker-rate-"));
  const filename = join(dir, "test.sqlite");
  const parent = testDb(filename);
  const now = Date.now() + 1_000_000;
  const script = `import {testDb} from ${JSON.stringify(new URL("./sqlite.js", import.meta.url).href)};
    import {createRepositories} from ${JSON.stringify(new URL("../src/db/repositories/index.js", import.meta.url).href)};
    const x=testDb(${JSON.stringify(filename)},false);
    try { console.log(createRepositories(x.db).cache.tryAcquireRequestSlot('/synthetic-rate',1,1,${now})); } finally { x.close(); }`;
  try {
    const run = promisify(execFile);
    const values = await Promise.all([run(process.execPath, ["--input-type=module", "-e", script]), run(process.execPath, ["--input-type=module", "-e", script])]);
    const slots = values.map((v) => Number(v.stdout.trim())).sort((a, b) => a - b);
    assert.deepEqual(slots, [0, 1000]);
  } finally { parent.close(); rmSync(dir, { recursive: true }); }
});
