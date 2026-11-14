import { test } from "node:test";
import assert from "node:assert/strict";
import { format, legacyPick, pickSlash } from "../src/lib/i18n.js";
import { legacyTextToMsg, msg, parseMsg, render, toLang, __catalog } from "../src/lib/messages.js";
import { assessSafety, safetyView } from "../src/lib/safety.js";
import { briefDescription, buildOperationIndex } from "../src/lib/openapi.js";
import { httpErrorMsg } from "../src/lib/client.js";
import { loadDoc } from "./helpers.js";
import { PLATFORMS } from "../src/lib/platforms.js";

const HAS_CJK = /[㐀-鿿]/;

test("platform hints do not imply that supplying private cookies enables unsupported operations", () => {
  const douyin = PLATFORMS.find((p) => p.id === "douyin")!;
  assert.match(douyin.note!, /不可调用/);
  assert.match(douyin.noteEn!, /disabled/i);
});

test("every catalog entry has both languages, and zh/en placeholders match", () => {
  for (const [code, { zh, en }] of Object.entries(__catalog)) {
    assert.ok(zh && en, code);
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(ph(zh), ph(en), `placeholders differ for ${code}`);
    assert.equal(HAS_CJK.test(en), false, `English text of ${code} contains CJK`);
  }
});

test("render produces exactly one language, including nested params and upstream text", () => {
  const m = msg("call.blocked", { reasons: [msg("reason.cookie_required"), msg("reason.register_device")] });
  const zh = render(m, "zh");
  const en = render(m, "en");
  assert.match(zh, /需要账号本人的私有 Cookie；会向平台注册设备/);
  assert.equal(HAS_CJK.test(en), false);
  assert.match(en, /requires the account owner's private cookie; registers a device/);

  const http = httpErrorMsg(401, { detail: { message: "Invalid API token", message_zh: "无效的API令牌" } });
  assert.equal(render(http, "zh"), "API Key 缺失或无效 — 无效的API令牌");
  assert.equal(render(http, "en"), "API key missing or invalid — Invalid API token");
});

test("messages survive a JSON round-trip (call log) and re-render per language", () => {
  const stored = JSON.stringify(msg("call.missingParams", { params: "url" }));
  const m = parseMsg(stored)!;
  assert.match(render(m, "zh"), /缺少必填参数：url/);
  assert.match(render(m, "en"), /Missing required parameter\(s\): url/);
  assert.equal(parseMsg("not json"), null);
});

test("toLang maps Rome locale values", () => {
  assert.equal(toLang("zh-CN"), "zh");
  assert.equal(toLang('"zh-CN"'), "zh");
  assert.equal(toLang("en"), "en");
  assert.equal(toLang(undefined), "en");
});

test("legacyPick cleans pre-i18n call-log text into one language", () => {
  const v1 = "API Key 缺失或无效 / API key missing or invalid — 无效的API令牌 / Invalid API token";
  assert.equal(legacyPick(v1, "zh"), "API Key 缺失或无效 — 无效的API令牌");
  assert.equal(legacyPick(v1, "en"), "API key missing or invalid — Invalid API token");
  const v2 = "缺少必填参数：url。\nMissing required parameter(s): url.";
  assert.equal(legacyPick(v2, "en"), "Missing required parameter(s): url.");
  assert.equal(legacyPick("Interrupted before completion", "zh"), "Interrupted before completion");
});

test("pickSlash splits TikHub summaries, keeping slashes inside a half", () => {
  assert.equal(pickSlash("获取用户笔记列表/Get user posted notes", "zh"), "获取用户笔记列表");
  assert.equal(pickSlash("获取用户笔记列表/Get user posted notes", "en"), "Get user posted notes");
  assert.equal(pickSlash("获取商品/店铺信息/Get product / shop info", "zh"), "获取商品/店铺信息");
  assert.equal(pickSlash("获取商品/店铺信息/Get product / shop info", "en"), "Get product / shop info");
  assert.equal(pickSlash("抖音渠道版本/Douyin channel: normal(正常版-默认)", "zh"), "抖音渠道版本");
  assert.equal(pickSlash("解析抖音/TikTok视频/Parse Douyin/TikTok video", "zh"), "解析抖音/TikTok视频");
  assert.equal(pickSlash("Only English/with slash", "zh"), "Only English/with slash");
});

test("format interpolates known vars and leaves unknown placeholders", () => {
  assert.equal(format("{n} 个接口 {x}", { n: 3 }), "3 个接口 {x}");
});

test("safety codes render in one language via safetyView", () => {
  const v = assessSafety({ path: "/api/v1/x/register_device", requiredFields: ["cookie"] });
  assert.deepEqual(v.codes, ["reason.register_device", "reason.unsupported_operation", "reason.cookie_required"]);
  assert.deepEqual(safetyView(v, "zh").reasons, ["会向平台注册设备", "不属于此版本支持的公开读取操作", "需要账号本人的私有 Cookie"]);
  assert.equal(safetyView(v, "en").reasons.some((r) => HAS_CJK.test(r)), false);
});

test("OpenAPI index carries a Chinese brief as well as the English one", () => {
  const op = buildOperationIndex(loadDoc()).find((o) => o.path === "/api/v1/hybrid/video_data")!;
  assert.match(op.brief, /parse data of a single Douyin\/TikTok video/i);
  assert.match(op.briefZh, /解析抖音\/TikTok单一视频/);
  assert.equal(briefDescription("no markers here", 50, "zh"), "no markers here");
});

test("English-only legacy log sentences are recognised and re-rendered in Chinese", () => {
  const blocked = legacyTextToMsg("Blocked: this endpoint requires the account owner's private cookie. Ask the guardian, then retry with confirm: true.");
  assert.equal(render(blocked!, "zh"), "已拦截：此接口需要账号本人的私有 Cookie。此版本仅支持公开只读数据，confirm 不能启用私有或变更操作。");
  assert.equal(render(legacyTextToMsg("Interrupted before completion")!, "zh"), "请求在完成前被中断");
  assert.match(render(legacyTextToMsg("Missing required parameter(s): url. Nothing was sent (no credits spent).")!, "zh"), /缺少必填参数：url/);
  assert.equal(legacyTextToMsg("something else entirely"), null);
});
