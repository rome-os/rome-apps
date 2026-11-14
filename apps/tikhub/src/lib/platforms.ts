/**
 * Platform aliases → TikHub OpenAPI tags. Ported from the guardian's
 * `workstation-core/.agents/skills/tikhub` skill and refreshed against
 * OpenAPI V5.3.2 (2026-09-29). Tag order = preference order.
 */
export interface PlatformInfo {
  id: string;
  /** Chinese display name. */
  label: string;
  labelEn: string;
  tags: string[];
  note?: string;
  noteEn?: string;
}

export const PLATFORMS: PlatformInfo[] = [
  {
    id: "douyin",
    label: "抖音", labelEn: "Douyin",
    tags: [
      "Douyin-Search-API",
      "Douyin-App-V3-API",
      "Douyin-Web-API",
      "Douyin-Billboard-API",
      "Douyin-Index-API",
      "Douyin-Xingtu-API",
      "Douyin-Xingtu-V2-API",
      "Douyin-Creator-API",
      "Douyin-Creator-V2-API",
      "Douyin-DouPlus-API",
    ],
    note: "搜索优先用 Douyin-Search-API；需要私有 Cookie 的 Creator V2 / DOU+ 接口在此版本不可调用。",
    noteEn: "Prefer Douyin-Search-API for search. Creator V2 / DOU+ operations requiring private cookies are disabled in this version.",
  },
  {
    id: "tiktok",
    label: "TikTok", labelEn: "TikTok",
    tags: [
      "TikTok-App-V3-API",
      "TikTok-Web-API",
      "TikTok-Creator-API",
      "TikTok-Analytics-API",
      "TikTok-Ads-API",
      "TikTok-Shop-Web-API",
    ],
    note: "App 数据优先用 TikTok-App-V3-API。",
    noteEn: "Prefer TikTok-App-V3-API for app data.",
  },
  {
    id: "xiaohongshu",
    label: "小红书", labelEn: "Xiaohongshu",
    tags: ["Xiaohongshu-App-V2-API", "Xiaohongshu-Web-V3-API", "Xiaohongshu-PGY-API"],
    note: "官方推荐 App V2：最稳定、字段最全。",
    noteEn: "App V2 is the recommended group: most stable and most complete.",
  },
  { id: "bilibili", label: "哔哩哔哩", labelEn: "Bilibili", tags: ["Bilibili-Web-API", "Bilibili-App-API", "Bilibili-Huahuo-API"] },
  { id: "kuaishou", label: "快手", labelEn: "Kuaishou", tags: ["Kuaishou-App-API", "Kuaishou-Web-API"] },
  { id: "weibo", label: "微博", labelEn: "Weibo", tags: ["Weibo-Web-V2-API", "Weibo-App-API"] },
  {
    id: "wechat",
    label: "微信", labelEn: "WeChat",
    tags: ["WeChat-Channels-V2-API", "WeChat-Media-Platform-V2-API", "WeChat-Search-V2-API"],
  },
  { id: "zhihu", label: "知乎", labelEn: "Zhihu", tags: ["Zhihu-Web-API"] },
  { id: "toutiao", label: "今日头条", labelEn: "Toutiao", tags: ["Toutiao-App-API", "Toutiao-Web-API"] },
  { id: "xigua", label: "西瓜视频", labelEn: "Xigua", tags: ["Xigua-App-V2-API"] },
  { id: "pipixia", label: "皮皮虾", labelEn: "PiPiXia", tags: ["PiPiXia-App-API"] },
  { id: "lemon8", label: "Lemon8", labelEn: "Lemon8", tags: ["Lemon8-App-API"] },
  { id: "instagram", label: "Instagram", labelEn: "Instagram", tags: ["Instagram-V1-API", "Instagram-V2-API", "Instagram-V3-API"], note: "优先用 V1，不够再用 V2/V3。",
    noteEn: "Prefer V1; fall back to V2/V3 when needed." },
  { id: "youtube", label: "YouTube", labelEn: "YouTube", tags: ["YouTube-Web-V2-API", "YouTube-Web-API"] },
  { id: "twitter", label: "X / Twitter", labelEn: "X / Twitter", tags: ["Twitter-Web-API"] },
  { id: "threads", label: "Threads", labelEn: "Threads", tags: ["Threads-Web-API"] },
  { id: "reddit", label: "Reddit", labelEn: "Reddit", tags: ["Reddit-APP-API"] },
  { id: "linkedin", label: "LinkedIn", labelEn: "LinkedIn", tags: ["LinkedIn-Web-V2-API", "LinkedIn-Web-API"] },
  { id: "telegram", label: "Telegram", labelEn: "Telegram", tags: ["Telegram-Web-API"] },
  { id: "hybrid", label: "通用解析", labelEn: "Hybrid parsing", tags: ["Hybrid-Parsing"], note: "用任意分享链接解析单条抖音/TikTok 视频。",
    noteEn: "Parse a single Douyin/TikTok video from any share link." },
  {
    id: "tikhub",
    label: "TikHub 账户与工具", labelEn: "TikHub account & tools",
    tags: ["TikHub-User-API", "Health-Check", "TikHub-Downloader-API", "Demo-API", "iOS-Shortcut"],
  },
];

export const PLATFORM_ALIASES: Record<string, string> = {
  dy: "douyin",
  tt: "tiktok",
  xhs: "xiaohongshu",
  rednote: "xiaohongshu",
  red: "xiaohongshu",
  bili: "bilibili",
  b站: "bilibili",
  ks: "kuaishou",
  weixin: "wechat",
  wx: "wechat",
  ig: "instagram",
  yt: "youtube",
  x: "twitter",
  抖音: "douyin",
  小红书: "xiaohongshu",
  快手: "kuaishou",
  微博: "weibo",
  知乎: "zhihu",
  微信: "wechat",
  哔哩哔哩: "bilibili",
};

/** Globally preferred tags when several groups can answer the same question. */
export const PREFERRED_TAGS = [
  "Douyin-Search-API",
  "TikTok-App-V3-API",
  "Xiaohongshu-App-V2-API",
  "Instagram-V1-API",
];

export function resolvePlatform(value: string | undefined | null): PlatformInfo | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  const id = PLATFORM_ALIASES[key] ?? PLATFORM_ALIASES[value.trim()] ?? key;
  return PLATFORMS.find((p) => p.id === id) ?? null;
}

export function platformForTag(tag: string | undefined | null): string | null {
  if (!tag) return null;
  const hit = PLATFORMS.find((p) => p.tags.includes(tag));
  if (hit) return hit.id;
  // Fall back to the tag prefix (e.g. "Douyin-Foo-API" → douyin) for tags added upstream later.
  const prefix = tag.split("-")[0]?.toLowerCase();
  return PLATFORMS.find((p) => p.id === prefix)?.id ?? null;
}

export function platformAliasList(): string[] {
  return [...PLATFORMS.map((p) => p.id), ...Object.keys(PLATFORM_ALIASES)];
}
