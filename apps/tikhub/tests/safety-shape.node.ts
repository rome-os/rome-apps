import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSafety, maskApiKey, redactSecrets } from "../src/lib/safety.js";
import { extractPagination, truncateForAgent, unwrapEnvelope } from "../src/lib/shape.js";

test("ordinary reads (incl. read-only POST and *_like* reads) are not guarded", () => {
  for (const path of [
    "/api/v1/douyin/app/v3/fetch_user_post_videos",
    "/api/v1/douyin/app/v3/fetch_user_like_videos",
    "/api/v1/twitter/web/fetch_post_comments",
    "/api/v1/douyin/billboard/fetch_hot_total_high_like_list",
  ]) {
    assert.equal(assessSafety({ path }).sensitive, false, path);
  }
});

test("mutation / auth / cookie endpoints are guarded", () => {
  assert.ok(assessSafety({ path: "/api/v1/douyin/app/v3/open_douyin_app_to_send_private_message" }).sensitive);
  assert.ok(assessSafety({ path: "/api/v1/pipixia/app/fetch_increase_post_view_count" }).sensitive);
  assert.ok(assessSafety({ path: "/api/v1/douyin/app/v3/register_device" }).sensitive);
  assert.ok(assessSafety({ path: "/api/v1/x", requiredFields: ["cookie"] }).sensitive);
  assert.ok(assessSafety({ path: "/api/v1/x", suppliedKeys: ["Cookie"] }).sensitive);
});

test("redaction and masking never leak secrets", () => {
  const r = redactSecrets({ query: { url: "u", cookie: "sid=1" }, body: { nested: { sessionid: "abc" } } }) as any;
  assert.equal(r.query.cookie, "[redacted]");
  assert.equal(r.query.url, "u");
  assert.equal(r.body.nested.sessionid, "[redacted]");
  assert.equal(maskApiKey("abcdefghijklmnopWXYZ"), "••••••••WXYZ");
  assert.equal(maskApiKey(null), null);
});

test("envelope unwrap drops boilerplate but keeps data", () => {
  const { data, meta } = unwrapEnvelope({ code: 200, request_id: "r1", message: "ok", support: "discord", cache_url: "c", data: { a: 1 } });
  assert.deepEqual(data, { a: 1 });
  assert.equal(meta.request_id, "r1");
});

test("pagination hints are found in nested payloads", () => {
  const p = extractPagination({ data: { cursor: 20, has_more: true, list: [] }, extra: { search_id: "s" } });
  assert.deepEqual(p, { "data.cursor": 20, "data.has_more": true, "extra.search_id": "s" });
});

test("truncation respects the budget and marks what it cut", () => {
  const big = { items: Array.from({ length: 500 }, (_, i) => ({ i, text: "x".repeat(500) })) };
  const r = truncateForAgent(big, 5000);
  assert.equal(r.truncated, true);
  assert.ok(JSON.stringify(r.value).length <= 5000);
  assert.match(JSON.stringify(r.value), /more items/);
  assert.equal(truncateForAgent({ a: 1 }, 100).truncated, false);
});
