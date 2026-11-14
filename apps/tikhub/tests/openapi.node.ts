import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOperationIndex, inspectOperation, parsePriceList, searchOperations } from "../src/lib/openapi.js";
import { resolvePlatform } from "../src/lib/platforms.js";
import { loadDoc, loadPrices } from "./helpers.js";

const doc = loadDoc();
const index = buildOperationIndex(doc);

test("index covers every documented operation with platform mapping", () => {
  assert.equal(index.length, Object.values(doc.paths).reduce((n, m) => n + Object.keys(m).length, 0));
  const xhs = index.find((o) => o.path === "/api/v1/xiaohongshu/app_v2/get_user_info")!;
  assert.equal(xhs.platform, "xiaohongshu");
  assert.equal(xhs.tag, "Xiaohongshu-App-V2-API");
});

test("platform aliases resolve (xhs, 抖音, x)", () => {
  assert.equal(resolvePlatform("xhs")?.id, "xiaohongshu");
  assert.equal(resolvePlatform("抖音")?.id, "douyin");
  assert.equal(resolvePlatform("X")?.id, "twitter");
  assert.equal(resolvePlatform("nope"), null);
});

test("search ranks the exact endpoint first and filters by platform", () => {
  const r = searchOperations(index, { query: "user posted notes", platform: "xhs" });
  assert.equal(r.items[0]!.path, "/api/v1/xiaohongshu/app_v2/get_user_posted_notes");
  assert.ok(r.items.every((o) => o.platform === "xiaohongshu"));
});

test("search demotes send_private_message style endpoints", () => {
  const r = searchOperations(index, { query: "douyin app user", platform: "douyin", limit: 50 });
  const last = r.items[r.items.length - 1]!;
  assert.match(last.path, /open_douyin_app_to_send_private_message/);
});

test("unknown platform returns empty with a marker", () => {
  const r = searchOperations(index, { query: "x", platform: "myspace" });
  assert.equal(r.total, 0);
  assert.equal(r.unknownPlatform, "myspace");
});

test("inspect resolves query params and POST body fields", () => {
  const get = inspectOperation(doc, "get", "/api/v1/hybrid/video_data")!;
  const url = get.parameters.find((p) => p.name === "url")!;
  assert.equal(url.required, true);
  assert.deepEqual(get.requiredFields, ["url"]);

  const post = inspectOperation(doc, "post", "/api/v1/douyin/web/fetch_user_collects")!;
  assert.ok(post.body, "POST body summarised");
  assert.ok(post.body!.fields.some((f) => /cookie/i.test(f.name) && f.required));
});

test("price list parses endpoint_cost", () => {
  const prices = parsePriceList(loadPrices());
  assert.equal(prices["/api/v1/hybrid/video_data"]?.costUsd, 0.001);
  assert.equal(prices["/api/v1/tikhub/user/get_user_info"]?.costUsd, 0);
});
