import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { BoundedCache } from "../src/lib/cache";
afterEach(() => vi.restoreAllMocks());

test("LRU reads retain hot metadata and count/byte limits are both enforced", async () => {
  const cache = new BoundedCache(2, 1500);
  let runs = 0;
  const value = async () => {
    runs++;
    return "small";
  };
  await cache.get("a", value);
  await cache.get("b", value);
  await cache.get("a", value);
  await cache.get("c", value);
  assert.equal(cache.size, 2);
  await cache.get("a", value);
  assert.equal(runs, 3);
  await cache.get("b", value);
  assert.equal(runs, 4);
  assert.ok(cache.bytes <= 1500);
  // Oversized payloads are returned, not cached, and cannot evict every hot entry.
  await cache.get("large", async () => "x".repeat(2000));
  assert.equal(cache.size, 2);
  const byteLimited = new BoundedCache(100, 1500);
  for (let i = 0; i < 30; i++)
    await byteLimited.get(String(i), async () => "x".repeat(100));
  assert.ok(byteLimited.size < 30);
  assert.ok(byteLimited.bytes <= 1500);
});

test("failures are immediately retryable, and forced refresh preserves single-flight", async () => {
  const cache = new BoundedCache(4, 10000);
  await assert.rejects(
    cache.get("pr", async () => {
      throw Error("offline");
    }),
  );
  assert.equal(cache.size, 0);
  assert.equal(await cache.get("pr", async () => "recovered"), "recovered");
  let finish!: (value: string) => void;
  const run = cache.get(
    "pr",
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    60000,
    true,
  );
  assert.equal(
    cache.get("pr", async () => "duplicate", 60000, true),
    run,
  );
  await Promise.resolve();
  finish("updated");
  assert.equal(await run, "updated");
  assert.equal(await cache.get("pr", async () => "unexpected"), "updated");
});

test("SWR retains stale values on failure and separate payload traffic cannot evict metadata", async () => {
  let time = 100;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  const metadata = new BoundedCache(2, 2000),
    payload = new BoundedCache(2, 2000);
  await metadata.get("repos", async () => ["repo"]);
  for (let i = 0; i < 10; i++)
    await payload.get(String(i), async () => "patch");
  assert.deepEqual(await metadata.get("repos", async () => []), ["repo"]);
  time += 30000;
  assert.deepEqual(
    await metadata.swr(
      "repos",
      async () => {
        throw Error("temporary");
      },
      1000,
    ),
    ["repo"],
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    await metadata.swr("repos", async () => ["new repo"], 1000),
    ["repo"],
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(await metadata.get("repos", async () => []), ["new repo"]);
});

test("production payload cache cannot evict a production metadata entry", async () => {
  const { cached, cachedPayload } = await import("../src/lib/git");
  const key = "review-metadata-isolation";
  await cached(key, async () => ["repo"], 60000);
  for (let i = 0; i < 40; i++)
    await cachedPayload("review-patch-" + i, async () => "x".repeat(10000));
  assert.deepEqual(await cached(key, async () => [], 60000), ["repo"]);
});
