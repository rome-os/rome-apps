/** Handwritten synthetic contracts/prices. No provider response, account or real examples. */
import type { OpenApiDoc } from "../src/lib/openapi.js";

export function fixtureDoc(): OpenApiDoc {
  const paths: OpenApiDoc["paths"] = {};
  const add = (method: string, path: string, tag: string, parameters: unknown[] = [], extra = {}) => {
    paths[path] = { [method]: { tags: [tag], operationId: path.split("/").at(-1), summary: path.split("/").at(-1)!.replaceAll("_", " "), parameters, ...extra } };
  };
  const q = (name: string, type = "string", required = false, value?: unknown) =>
    ({ name, in: "query", required, description: "合成参数/Synthetic parameter", schema: { type, ...(value === undefined ? {} : { default: value }) } });
  add("get", "/api/v1/hybrid/video_data", "Hybrid-API", [q("url","string",true),q("minimal","boolean",false,false),q("base64_url","boolean",false,false)], {
    summary: "混合解析单一视频接口/Hybrid parsing single video endpoint",
    description: "# [中文] 解析抖音/TikTok单一视频（合成合同）。 # [English] Parse data of a single Douyin/TikTok video (synthetic contract)."
  });
  add("get", "/api/v1/health/check", "Health-Check-API");
  add("get", "/api/v1/tikhub/user/get_user_info", "TikHub-User-API");
  add("post", "/api/v1/douyin/web/fetch_user_collects", "Douyin-Web-API", [], {
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["cookie"], properties: { cookie: { type: "string" }, counts: { type: "integer" } } } } } }
  });
  add("get", "/api/v1/douyin/app/v3/open_douyin_app_to_send_private_message", "Douyin-App-V3-API", [q("uid","string",true),q("sec_uid","string",true)]);
  add("get", "/api/v1/pipixia/app/fetch_increase_post_view_count", "Pipixia-App-API", [q("cell_id","string",true)]);
  add("post", "/api/v1/douyin/search/fetch_general_search_v1", "Douyin-Search-API", [], {
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { keyword: { type: "string" }, cursor: { type: "integer", default: 0 } } } } } }
  });
  for (const name of ["get_image_note_detail","get_video_note_detail","get_note_comments","get_note_sub_comments","get_user_info","get_user_posted_notes"])
    add("get", "/api/v1/xiaohongshu/app_v2/" + name, "Xiaohongshu-App-V2-API", [q("note_id"),q("share_text"),q("user_id"),q("cursor")]);
  for (const name of ["fetch_user_fans_list","fetch_user_post_videos","fetch_user_like_videos","fetch_user_series_list"])
    add("get", "/api/v1/douyin/app/v3/" + name, "Douyin-App-V3-API", [q("sec_user_id"),q("max_cursor","integer",false,0),q("count","integer",false,20)]);
  for (const name of ["fetch_user_country_by_username","fetch_user_repost_videos","fetch_user_post_videos"])
    add("get", "/api/v1/tiktok/app/v3/" + name, "TikTok-App-V3-API", [q("username"),q("user_id","integer"),q("sec_user_id"),q("max_cursor","integer",false,0),q("count","integer",false,20)]);
  return { info: { title: "Synthetic offline test API", version: "synthetic-1" }, paths };
}

export function fixturePrices(): unknown[] {
  return Object.keys(fixtureDoc().paths).map(path => ({
    endpoint_uri: path, endpoint_cost: path.includes("/tikhub/") || path.includes("/health/") ? 0 : path.includes("/xiaohongshu/") ? 0.01 : 0.001,
    allow_free_credit: 0, allow_discount: 0, rate_limit: "10/second"
  }));
}
