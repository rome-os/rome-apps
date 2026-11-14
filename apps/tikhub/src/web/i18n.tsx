/**
 * i18n for the TikHub web UI (zh / en). There is no per-app language setting:
 * the UI always follows Rome's global language.
 *
 * Source of truth, in order:
 *   1. `document.documentElement.lang` — the Rome dashboard sets it on every
 *      language change, and apps mount in the same document (shadow DOM), so a
 *      MutationObserver makes the switch live without a reload;
 *   2. `bootstrap.shell.locale` (value at mount);
 *   3. the browser language.
 *
 * Only one language is ever shown. Backend messages are rendered server-side
 * in the language this page sends (see `setApiLang`).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getBootstrap } from "@rome-os/app-web-sdk";
import { format } from "../lib/i18n";
import { setApiLang } from "./api";

export type Lang = "zh" | "en";

const zh = {
  "app.description": "抖音、TikTok、小红书等 20+ 平台的数据接口 · 找接口、看价格、试调用、查记录",
  "app.noKeySuffix": " · 未配置 API Key",
  "app.navLabel": "TikHub 导航",
  "app.backendError": "无法连接 TikHub App 后端",
  "nav.overview": "概览",
  "nav.explorer": "接口",
  "nav.calls": "调用记录",
  "nav.settings": "设置",

  "common.loading": "加载中…",
  "common.error": "出错了",
  "common.refresh": "刷新",
  "common.refreshing": "刷新中",
  "common.retry": "重试",
  "common.unknownError": "未知错误",
  "common.yes": "是",
  "common.no": "否",
  "common.saving": "保存中",

  "status.ok": "成功",
  "status.error": "失败",
  "status.blocked": "已拦截",
  "status.dry_run": "预览",
  "status.pending": "进行中",
  "status.outcome_unknown": "结果未知",
  "overview.unknownCosts": "另有 {n} 次费用未知；此处不是最终结算金额。",

  "overview.loading": "正在加载",
  "overview.noKeyTitle": "还没有 API Key",
  "overview.noKeyDesc": "到 user.tikhub.io 创建一个 API Key，然后在设置里保存。接口浏览和价格查询不需要 Key。",
  "overview.goSettings": "去设置",
  "overview.browseFirst": "先浏览接口",
  "overview.partialError": "部分数据加载失败",
  "overview.account": "账户",
  "overview.accountDesc": "余额和 Key 状态来自 TikHub，查询免费。",
  "overview.accountError": "无法读取账户",
  "overview.balance": "余额 (USD)",
  "overview.freeCredit": "免费额度",
  "overview.connectivity": "连通性",
  "overview.unavailable": "不可用",
  "overview.expires": "到期 {date}",
  "overview.noExpiry": "长期有效",
  "overview.calls7d": "近 7 天调用",
  "overview.callsSummary": "{calls} 次 · 成功 {ok} · 失败 {errors} · 预估花费 {cost}",
  "overview.callsHint": "通过本 App（Agent 或页面）发出的请求。",
  "overview.viewCalls": "调用记录",
  "overview.noCalls": "还没有调用。在「接口」里找一个接口试试，或让 Agent 用 TikHub 查数据。",
  "overview.chartLabel": "每日调用次数",
  "overview.barTitle": "{date}：{calls} 次，{cost}",
  "overview.platformCalls": "{platform} {calls} 次",
  "overview.dailyUsage": "TikHub 每日用量",
  "overview.dailyUsageDesc": "TikHub 返回的原始用量报告，包含非本 App 发出的请求。",
  "overview.dailyUsageError": "用量读取失败",
  "overview.showRaw": "展开原始数据",
  "overview.catalog": "接口目录",
  "overview.catalogDesc": "OpenAPI 文档和价格表每 24 小时自动更新一次。",
  "overview.updateNow": "立即更新",
  "overview.updating": "更新中",
  "overview.version": "版本",
  "overview.operations": "接口数",
  "overview.operationsValue": "{ops} · {platforms} 个平台",
  "overview.docsUpdated": "文档更新",
  "overview.pricesUpdated": "价格更新",

  "explorer.platform": "平台",
  "explorer.choosePlatform": "选择平台",
  "explorer.searchPlaceholder": "用英文关键词搜索，如 user profile、search video、comment",
  "explorer.searchLabel": "搜索接口",
  "explorer.searchError": "搜索失败",
  "explorer.count": "{count} 个接口",
  "explorer.updating": " · 更新中…",
  "explorer.noMatch": "没有匹配的接口。换个关键词（英文效果更好），或切换平台。",
  "explorer.guarded": "不支持",
  "explorer.guardedTitle": "私有凭据、账号变更或非支持操作不可调用",
  "explorer.loadMore": "加载更多（还有 {n} 个）",
  "explorer.loadingList": "正在加载接口",

  "endpoint.back": "返回接口列表",
  "endpoint.notFound": "找不到接口",
  "endpoint.group": "分组",
  "endpoint.price": "单价",
  "endpoint.perCall": "{cost} / 次",
  "endpoint.freeCredit": " · 可用免费额度",
  "endpoint.rateLimit": "限速",
  "endpoint.docs": "文档",
  "endpoint.guardedTitle": "此版本不支持此接口",
  "endpoint.guardedDesc": "{reasons}。此版本仅支持公开读取，不能通过确认启用。",
  "endpoint.reasonSep": "；",
  "endpoint.tryIt": "试一下",
  "endpoint.tryItDesc": "预览仅生成脱敏请求，不扣费；单价是基准估算，不是结算或封顶价，最终以 TikHub 用量为准。",
  "endpoint.tryItNeedKey": "预览仅生成脱敏请求，不扣费；发送需先配置 Key，单价是基准估算，不是封顶价。",
  "endpoint.required": "必填",
  "endpoint.omit": "（不传）",
  "endpoint.defaultValue": "默认 {value}",
  "endpoint.body": "请求体 JSON",
  "endpoint.bodyFields": "字段：{fields}",
  "endpoint.listSep": "、",
  "endpoint.noParams": "此接口没有参数。",
  "endpoint.confirm": "我确认要调用这个需要确认的接口",
  "endpoint.preview": "预览请求",
  "endpoint.previewing": "预览中",
  "endpoint.send": "发送（约 {cost}）",
  "endpoint.sending": "请求中…",
  "endpoint.invalidJson": "请求体不是合法的 JSON",
  "endpoint.notSent": "请求没有发出",
  "endpoint.result": "结果",
  "endpoint.retries": "重试 {n} 次",
  "endpoint.spent": "基准估算 {cost}",
  "cost.baseEstimate": "基准估算 {cost}",
  "cost.notBilled": "未计费",
  "cost.unknown": "费用未知，请先核对用量再决定是否重发",
  "endpoint.unconfirmed": "无法确认调用结果",
  "endpoint.failed": "请求失败",
  "endpoint.pagination": "翻页参数",
  "endpoint.viewInLog": "在调用记录中查看",

  "calls.filterLabel": "按状态筛选",
  "calls.all": "全部",
  "calls.loadError": "加载失败",
  "calls.empty": "还没有数据调用记录。目录、余额和用量查询不计入此账本；金额为基准估算。",
  "calls.time": "时间",
  "calls.endpoint": "接口",
  "calls.status": "状态",
  "calls.source": "来源",
  "calls.duration": "耗时",
  "calls.cost": "花费",
  "calls.sourceAgent": "Agent",
  "calls.sourceUi": "页面",
  "calls.loadMore": "加载更多（共 {total} 条）",
  "calls.back": "返回调用记录",
  "calls.notFound": "找不到这条记录",
  "calls.attempts": "（{n} 次尝试）",
  "calls.responseSize": "响应大小",
  "calls.openEndpoint": "打开这个接口",
  "calls.request": "请求参数",
  "calls.response": "响应预览",

  "settings.loadError": "设置加载失败",
  "settings.saveError": "保存失败",
  "settings.loading": "正在加载设置",
  "settings.apiKeyDesc": "在 user.tikhub.io 创建。Key 以明文保存在本机 Rome 数据库里，设置读取只返回后 4 位；错误和调用记录按脱敏规则处理。",
  "settings.current": "当前：{masked}",
  "settings.noKey": "还没有保存 Key",
  "settings.replacePlaceholder": "粘贴新 Key 以替换",
  "settings.pastePlaceholder": "粘贴 TikHub API Key",
  "settings.saveKey": "保存 Key",
  "settings.keySaved": "API Key 已保存",
  "settings.test": "测试连接",
  "settings.testing": "测试中",
  "settings.deleteKey": "删除 Key",
  "settings.keyDeleted": "API Key 已删除",
  "settings.reachable": "服务可达 · {ms} ms",
  "settings.unreachable": "服务不可达：{error}",
  "settings.keyValid": "Key 有效 · {email} · 余额 {balance}",
  "settings.keyInvalid": "Key 校验失败：{error}",
  "settings.onlyConnectivity": "未配置 Key，只测试了连通性",
  "settings.network": "网络与请求",
  "settings.networkDesc": "数据请求（含账户查询）只发送一次；超时或响应丢失不会自动重试。仅公开目录读取可重试；限速通过应用数据库跨进程协调。",
  "settings.baseUrl": "接口地址",
  "settings.baseUrl.global": "api.tikhub.io（全球）",
  "settings.baseUrl.china": "api.tikhub.dev（旧兼容地址，不推荐）",
  "settings.timeout": "超时（秒）",
  "settings.retries": "公开目录最多重试",
  "settings.qps": "每秒请求数",
  "settings.saveNetwork": "保存网络设置",
  "settings.networkSaved": "网络设置已保存",
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  "app.description": "Data APIs for Douyin, TikTok, Xiaohongshu and 20+ platforms · find endpoints, check prices, try calls, review history",
  "app.noKeySuffix": " · API key not set",
  "app.navLabel": "TikHub navigation",
  "app.backendError": "Can't reach the TikHub app backend",
  "nav.overview": "Overview",
  "nav.explorer": "Endpoints",
  "nav.calls": "Calls",
  "nav.settings": "Settings",

  "common.loading": "Loading…",
  "common.error": "Something went wrong",
  "common.refresh": "Refresh",
  "common.refreshing": "Refreshing",
  "common.retry": "Retry",
  "common.unknownError": "Unknown error",
  "common.yes": "Yes",
  "common.no": "No",
  "common.saving": "Saving",

  "status.ok": "OK",
  "status.error": "Failed",
  "status.blocked": "Blocked",
  "status.dry_run": "Preview",
  "status.pending": "Running",
  "status.outcome_unknown": "Outcome unknown",
  "overview.unknownCosts": "{n} additional calls have unknown cost; this is not a settled total.",

  "overview.loading": "Loading",
  "overview.noKeyTitle": "No API key yet",
  "overview.noKeyDesc": "Create an API key at user.tikhub.io, then save it in Settings. Browsing endpoints and prices works without a key.",
  "overview.goSettings": "Open settings",
  "overview.browseFirst": "Browse endpoints",
  "overview.partialError": "Some data failed to load",
  "overview.account": "Account",
  "overview.accountDesc": "Balance and key status come from TikHub; checking them is free.",
  "overview.accountError": "Couldn't read the account",
  "overview.balance": "Balance (USD)",
  "overview.freeCredit": "Free credit",
  "overview.connectivity": "Connectivity",
  "overview.unavailable": "Unavailable",
  "overview.expires": "Expires {date}",
  "overview.noExpiry": "No expiry",
  "overview.calls7d": "Calls, last 7 days",
  "overview.callsSummary": "{calls} calls · {ok} OK · {errors} failed · est. {cost}",
  "overview.callsHint": "Requests made through this app (agent or page).",
  "overview.viewCalls": "Calls",
  "overview.noCalls": "No calls yet. Try an endpoint under Endpoints, or ask the agent to look something up with TikHub.",
  "overview.chartLabel": "Calls per day",
  "overview.barTitle": "{date}: {calls} calls, {cost}",
  "overview.platformCalls": "{platform} {calls}",
  "overview.dailyUsage": "TikHub daily usage",
  "overview.dailyUsageDesc": "Raw usage report from TikHub, including requests made outside this app.",
  "overview.dailyUsageError": "Couldn't read usage",
  "overview.showRaw": "Show raw data",
  "overview.catalog": "Endpoint catalog",
  "overview.catalogDesc": "The OpenAPI document and price list refresh automatically every 24 hours.",
  "overview.updateNow": "Update now",
  "overview.updating": "Updating",
  "overview.version": "Version",
  "overview.operations": "Endpoints",
  "overview.operationsValue": "{ops} · {platforms} platforms",
  "overview.docsUpdated": "Docs updated",
  "overview.pricesUpdated": "Prices updated",

  "explorer.platform": "Platform",
  "explorer.choosePlatform": "Choose a platform",
  "explorer.searchPlaceholder": "Search in English, e.g. user profile, search video, comment",
  "explorer.searchLabel": "Search endpoints",
  "explorer.searchError": "Search failed",
  "explorer.count": "{count} endpoints",
  "explorer.updating": " · updating…",
  "explorer.noMatch": "No matching endpoints. Try other keywords or another platform.",
  "explorer.guarded": "Unsupported",
  "explorer.guardedTitle": "Private credentials, account changes and unsupported operations are disabled",
  "explorer.loadMore": "Load more ({n} left)",
  "explorer.loadingList": "Loading endpoints",

  "endpoint.back": "Back to endpoints",
  "endpoint.notFound": "Endpoint not found",
  "endpoint.group": "Group",
  "endpoint.price": "Price",
  "endpoint.perCall": "{cost} / call",
  "endpoint.freeCredit": " · free credit OK",
  "endpoint.rateLimit": "Rate limit",
  "endpoint.docs": "Docs",
  "endpoint.guardedTitle": "Unsupported in this version",
  "endpoint.guardedDesc": "It {reasons}. Only public reads are supported; confirmation cannot enable it.",
  "endpoint.reasonSep": "; ",
  "endpoint.tryIt": "Try it",
  "endpoint.tryItDesc": "Preview builds a redacted request and is free. Prices are base estimates, not settled totals or caps; verify provider usage.",
  "endpoint.tryItNeedKey": "Preview builds a redacted request for free. Save a key before sending; the price is a base estimate, not a cap.",
  "endpoint.required": "Required",
  "endpoint.omit": "(omit)",
  "endpoint.defaultValue": "Default {value}",
  "endpoint.body": "JSON body",
  "endpoint.bodyFields": "Fields: {fields}",
  "endpoint.listSep": ", ",
  "endpoint.noParams": "This endpoint takes no parameters.",
  "endpoint.confirm": "I confirm calling this guarded endpoint",
  "endpoint.preview": "Preview request",
  "endpoint.previewing": "Previewing",
  "endpoint.send": "Send (~{cost})",
  "endpoint.sending": "Sending…",
  "endpoint.invalidJson": "The body is not valid JSON",
  "endpoint.notSent": "Request not sent",
  "endpoint.result": "Result",
  "endpoint.retries": "{n} retries",
  "endpoint.spent": "Base estimate {cost}",
  "cost.baseEstimate": "Base estimate {cost}",
  "cost.notBilled": "Not billed",
  "cost.unknown": "Cost unknown; check usage before deciding whether to send again",
  "endpoint.unconfirmed": "Call outcome unconfirmed",
  "endpoint.failed": "Request failed",
  "endpoint.pagination": "Pagination",
  "endpoint.viewInLog": "View in call log",

  "calls.filterLabel": "Filter by status",
  "calls.all": "All",
  "calls.loadError": "Failed to load",
  "calls.empty": "No data calls yet. Catalog, balance and usage queries are outside this ledger; amounts are base estimates.",
  "calls.time": "Time",
  "calls.endpoint": "Endpoint",
  "calls.status": "Status",
  "calls.source": "Source",
  "calls.duration": "Duration",
  "calls.cost": "Cost",
  "calls.sourceAgent": "Agent",
  "calls.sourceUi": "Page",
  "calls.loadMore": "Load more ({total} total)",
  "calls.back": "Back to calls",
  "calls.notFound": "Call not found",
  "calls.attempts": " ({n} attempts)",
  "calls.responseSize": "Response size",
  "calls.openEndpoint": "Open this endpoint",
  "calls.request": "Request",
  "calls.response": "Response preview",

  "settings.loadError": "Failed to load settings",
  "settings.saveError": "Save failed",
  "settings.loading": "Loading settings",
  "settings.apiKeyDesc": "Create one at user.tikhub.io. The key is stored in plain text in this Rome's local database; settings reads return only the last 4 characters; errors and call logs are redacted.",
  "settings.current": "Current: {masked}",
  "settings.noKey": "No key saved yet",
  "settings.replacePlaceholder": "Paste a new key to replace it",
  "settings.pastePlaceholder": "Paste your TikHub API key",
  "settings.saveKey": "Save key",
  "settings.keySaved": "API key saved",
  "settings.test": "Test connection",
  "settings.testing": "Testing",
  "settings.deleteKey": "Delete key",
  "settings.keyDeleted": "API key deleted",
  "settings.reachable": "Service reachable · {ms} ms",
  "settings.unreachable": "Service unreachable: {error}",
  "settings.keyValid": "Key valid · {email} · balance {balance}",
  "settings.keyInvalid": "Key check failed: {error}",
  "settings.onlyConnectivity": "No key configured; only connectivity was tested",
  "settings.network": "Network & requests",
  "settings.networkDesc": "Data and account requests are sent once, never replayed on timeout or a lost response. Only public catalog reads may retry; rate slots are coordinated across processes through the app database.",
  "settings.baseUrl": "API host",
  "settings.baseUrl.global": "api.tikhub.io (global)",
  "settings.baseUrl.china": "api.tikhub.dev (legacy, not recommended)",
  "settings.timeout": "Timeout (s)",
  "settings.retries": "Public catalog retries",
  "settings.qps": "Requests per second",
  "settings.saveNetwork": "Save network settings",
  "settings.networkSaved": "Network settings saved",
};

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en };

function toLang(locale: string | null | undefined): Lang | null {
  if (!locale) return null;
  return /^zh/i.test(locale) ? "zh" : "en";
}

/** Rome's current global language. */
export function detectLang(): Lang {
  if (typeof document !== "undefined") {
    const fromHtml = toLang(document.documentElement.lang);
    if (fromHtml) return fromHtml;
  }
  try {
    const fromBootstrap = toLang(getBootstrap().shell?.locale);
    if (fromBootstrap) return fromBootstrap;
  } catch {
    /* not mounted by the host (tests / preview) */
  }
  return toLang(typeof navigator !== "undefined" ? navigator.language : "") ?? "en";
}

interface I18nValue {
  lang: Lang;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const initial = detectLang();
    setApiLang(initial);
    return initial;
  });

  // Follow Rome's language live: the dashboard rewrites <html lang> on every switch.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      const next = detectLang();
      setApiLang(next);
      setLang(next);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      locale: lang === "zh" ? "zh-CN" : "en-US",
      t: (key, vars) => format(MESSAGES[lang][key] ?? MESSAGES.zh[key] ?? key, vars),
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

export const __messages = MESSAGES;
