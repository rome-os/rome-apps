/**
 * Language-neutral messages for everything the backend says to a person or an
 * agent. Code paths build `Msg` values; they are rendered into ONE language at
 * the edge (API response, action result) — never both at once. Messages are
 * stored as JSON in the call log so history re-renders in the current language.
 */

export type Lang = "zh" | "en";

export type MsgParam = string | number | Msg | Msg[];

export interface Msg {
  code: MsgCode;
  params?: Record<string, MsgParam>;
  /** TikHub's own message in both languages (message_zh / message). */
  upstream?: { zh: string; en: string };
}

const CATALOG = {
  "common.unknown": { zh: "未知错误", en: "Unknown error" },
  "common.internal": { zh: "TikHub 应用内部错误（已隐藏诊断细节）", en: "Internal TikHub app error (diagnostic details withheld)" },
  "cost.baseEstimate": { zh: "基准估算 {cost}", en: "Base estimate {cost}" },
  "cost.notBilled": { zh: "未计费", en: "Not billed" },
  "cost.unknown": { zh: "费用未知；请先核对用量，不要直接重发", en: "Cost unknown; check usage before deciding whether to send again" },
  "action.callFailed": { zh: "{detail}\n调用记录 {callId}；尝试 {attempts} 次；{cost}", en: "{detail}\nCall log {callId}; attempts {attempts}; {cost}" },
  "api.notFound": { zh: "此 TikHub 页面接口不存在", en: "This TikHub app API route does not exist" },
  "call.invalidParams": { zh: "参数未通过本地校验：{params}。请求没有发出，没有扣费。", en: "Local validation failed: {params}. Nothing was sent (no credits spent)." },

  "http.400": { zh: "请求参数有误", en: "Bad request" },
  "http.401": { zh: "API Key 缺失或无效", en: "API key missing or invalid" },
  "http.402": { zh: "余额不足，请到 user.tikhub.io 充值", en: "Insufficient balance — top up at user.tikhub.io" },
  "http.403": { zh: "API Key 没有该接口的权限（scope）", en: "API key lacks scope for this endpoint" },
  "http.404": { zh: "接口或资源不存在", en: "Not found" },
  "http.422": { zh: "参数校验失败", en: "Validation error" },
  "http.429": { zh: "请求过快，已触发限流", en: "Rate limited" },
  "http.5xx": { zh: "TikHub 或上游平台暂时出错（HTTP {status}）", en: "TikHub or upstream platform error (HTTP {status})" },
  "http.other": { zh: "请求失败（HTTP {status}）", en: "Request failed (HTTP {status})" },
  "net.timeout": { zh: "请求超时（{seconds} 秒）", en: "Timed out after {seconds}s" },
  "net.error": { zh: "网络错误：{detail}", en: "Network error: {detail}" },
  "net.unknown": { zh: "请求结果未知；不会自动重试，请核对用量后再决定是否重发", en: "Request outcome unknown; not retried. Check usage before deciding whether to send again" },
  "net.tooLarge": { zh: "响应超过读取上限，已停止读取；不会自动重发", en: "Response exceeds the read limit; reading stopped and the request was not replayed" },
  "net.redirect": { zh: "已拒绝上游重定向，不会转发凭据或请求体", en: "Upstream redirect refused; credentials and request bodies are not forwarded" },
  "net.invalidJson": { zh: "上游没有返回合法 JSON，响应正文已隐藏", en: "Upstream did not return valid JSON; the response body was withheld" },
  "security.privateAction": { zh: "此操作仅允许宿主验证过的监护人在私有上下文中执行；访客、群聊和身份不明的任务不可调用", en: "This action requires a host-verified guardian in a private context; visitors, groups and unattributed tasks are denied" },
  "log.withheld": { zh: "旧记录或截断内容无法安全解析，预览已隐藏（原数据未修改）", en: "Legacy or truncated content cannot be safely parsed; preview withheld (stored data unchanged)" },
  "http.business": { zh: "TikHub 返回业务错误（code {code}）", en: "TikHub returned a business error (code {code})" },
  "reason.private_input": { zh: "涉及私有凭据或会话", en: "uses private credentials or session material" },
  "reason.unsupported_operation": { zh: "不属于此版本支持的公开读取操作", en: "is not a supported public read operation" },
  "reason.deprecated": { zh: "已被上游标记为弃用", en: "is deprecated by the provider" },

  "config.noKey": {
    zh: "还没有配置 TikHub API Key，请到 TikHub App → 设置 中添加。",
    en: "TikHub API key is not configured. Open the TikHub app → Settings to add one.",
  },
  "config.badUrl": { zh: "接口地址不是合法的 URL", en: "Base URL is not a valid URL" },
  "config.httpsOnly": { zh: "接口地址必须使用 https", en: "Base URL must use https" },
  "config.hostNotAllowed": { zh: "仅支持 https://api.tikhub.io（推荐）及兼容地址 https://api.tikhub.dev，不允许其他端口、凭据或路径", en: "Only https://api.tikhub.io (recommended) and legacy https://api.tikhub.dev are allowed, without ports, credentials or paths" },
  "config.badPath": { zh: "接口路径不是允许的规范路径", en: "Endpoint path is not a permitted canonical path" },
  "config.undocumented": { zh: "此路径或方法没有受支持的接口合同，请先刷新目录", en: "This path or method has no supported contract; refresh the catalog first" },
  "config.staleSchema": { zh: "接口合同已过期，刷新成功前不会发送数据请求", en: "The endpoint contract is stale; data requests are disabled until refresh succeeds" },
  "config.requestTooLarge": { zh: "请求超过允许的输入上限", en: "Request exceeds the input size limit" },
  "config.busy": { zh: "请求队列已满或协调失败；请求没有发出", en: "Request queue full or coordination unavailable; nothing was sent" },
  "config.priceUnavailable": { zh: "没有有效的最新报价，已停止发送；请刷新目录后重试", en: "No valid current quote; request not sent. Refresh the catalog first" },
  "config.badKey": { zh: "API Key 格式不对（至少 16 位且不含空格）", en: "API key looks malformed (≥16 chars, no spaces)" },
  "config.pathPrefix": { zh: "接口路径必须以 /api/ 开头：{path}", en: "Endpoint path must start with /api/: {path}" },
  "config.badMethod": { zh: "不支持的 HTTP 方法：{method}", en: "Unsupported HTTP method: {method}" },
  "config.badBody": { zh: "请求体必须是 JSON 对象（字符串无法解析）", en: "body must be a JSON object (string could not be parsed)" },
  "config.missingPathParam": { zh: "缺少路径参数 \"{name}\"", en: "Missing path parameter \"{name}\"" },

  "schema.loadFailed": { zh: "无法加载 TikHub 接口文档：{cause}", en: "Could not load TikHub OpenAPI schema: {cause}" },
  "inspect.notFound": { zh: "TikHub 接口文档 {version} 中没有这个接口：{path}", en: "Path not found in TikHub OpenAPI {version}: {path}" },
  "inspect.methodNotDefined": { zh: "{path} 不支持 {method}，可用：{available}", en: "{method} is not defined for {path}; available: {available}" },
  "inspect.failure": { zh: "{detail}", en: "{detail}" },
  "inspect.didYouMean": { zh: "你要找的可能是：{list}", en: "Did you mean: {list}" },
  "search.unknownPlatform": { zh: "未知平台 \"{value}\"。可用：{known}", en: "Unknown platform \"{value}\". Known: {known}" },

  "warn.methodNotDocumented": {
    zh: "文档中 {path} 没有 {method} 方法，文档记载的是：{documented}",
    en: "{method} is not documented for {path}; documented: {documented}",
  },
  "warn.notInSchema": { zh: "接口不在已缓存的 OpenAPI {version} 中，不会发送数据请求。", en: "Path is not in the cached OpenAPI {version}; data requests are disabled." },
  "warn.schemaUnavailable": { zh: "接口文档不可用（{detail}），不会发送数据请求。", en: "OpenAPI schema unavailable ({detail}); data requests are disabled." },
  "warn.movedToBody": { zh: "已把 {fields} 从查询参数移到 JSON 请求体。", en: "Moved {fields} from query into the JSON body." },
  "warn.truncated": {
    zh: "响应过大已截断（{from} → ≤{max} 字符），记录 {callId} 仅保留裁剪预览，不保证更完整。",
    en: "Response truncated for context ({from} → ≤{max} chars). Log {callId} contains only a bounded preview, not a full backup.",
  },
  "warn.paginationOmitted": { zh: "部分分页提示超过返回预算或不是受支持的标量，已省略；不要把不完整提示当作可用游标。", en: "Some pagination hints exceeded the return budget or were not supported scalars and were omitted; do not treat incomplete hints as usable cursors." },

  "call.blocked": {
    zh: "已拦截：此接口{reasons}。此版本仅支持公开只读数据，confirm 不能启用私有或变更操作。",
    en: "Blocked: this endpoint {reasons}. This version supports public read-only data only; confirm cannot enable private or mutating operations.",
  },
  "call.missingParams": {
    zh: "缺少必填参数：{params}。请求没有发出，没有扣费。",
    en: "Missing required parameter(s): {params}. Nothing was sent (no credits spent).",
  },
  "call.interrupted": { zh: "请求在完成前被中断", en: "Interrupted before completion" },

  "hint.searchNext": {
    zh: "选定接口后，先用 tikhub:tikhub_inspect_endpoint 查看它的参数，再调用。",
    en: "Call tikhub:tikhub_inspect_endpoint with the chosen path to see its parameters before calling it.",
  },
  "hint.inspectNext": { zh: "用这个路径和上面的参数调用 tikhub:tikhub_call。", en: "Call tikhub:tikhub_call with this path and the parameters above." },
  "hint.inspectGuarded": {
    zh: "此版本不支持此接口（{reasons}）；不要提交私有凭据，也不要使用 confirm 尝试解锁。",
    en: "This endpoint is unsupported ({reasons}); do not supply private credentials or try to unlock it with confirm.",
  },

  "reason.private_message": { zh: "会发送或准备私信", en: "sends or prepares a private message" },
  "reason.inflate": { zh: "会刷量（增加播放、点赞等）", en: "inflates engagement metrics" },
  "reason.register_device": { zh: "会向平台注册设备", en: "registers a device with the platform" },
  "reason.login": { zh: "涉及账号登录或会话认证", en: "touches account login or session auth" },
  "reason.login_crypto": { zh: "处理登录请求加解密", en: "handles login request crypto" },
  "reason.account_write": { zh: "会写入平台账号", en: "writes to a platform account" },
  "reason.cookie_required": { zh: "需要账号本人的私有 Cookie", en: "requires the account owner's private cookie" },
  "reason.cookie_supplied": { zh: "请求中带有私有 Cookie", en: "a private cookie is being sent" },
} as const;

export type MsgCode = keyof typeof CATALOG;

const LIST_SEP: Record<Lang, string> = { zh: "；", en: "; " };

export function msg(code: MsgCode, params?: Record<string, MsgParam>, upstream?: Msg["upstream"]): Msg {
  return { code, ...(params ? { params } : {}), ...(upstream ? { upstream } : {}) };
}

function isMsg(v: unknown): v is Msg {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as Msg).code === "string";
}

export function render(m: Msg, lang: Lang): string {
  const entry = (CATALOG as Record<string, { zh: string; en: string }>)[m.code];
  const template = entry ? entry[lang] : CATALOG["common.internal"][lang];
  const text = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = m.params?.[key];
    if (v === undefined) return whole;
    if (Array.isArray(v)) return v.map((x) => render(x, lang)).join(LIST_SEP[lang]);
    if (isMsg(v)) return render(v, lang);
    return String(v);
  });
  const up = m.upstream ? (lang === "zh" ? m.upstream.zh || m.upstream.en : m.upstream.en || m.upstream.zh) : "";
  return up && up !== text ? `${text} — ${up}` : text;
}

/** Map any locale string ("zh-CN", "zh", "en-US", JSON-quoted values …) to a supported language. */
export function toLang(value: unknown): Lang {
  const s = typeof value === "string" ? value.replace(/^"|"$/g, "") : "";
  return /^zh/i.test(s) ? "zh" : "en";
}

/** Parse a stored message (call log) safely. */
export function parseMsg(json: string | null | undefined): Msg | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return isMsg(v) && Object.hasOwn(CATALOG, v.code) ? v : null;
  } catch {
    return null;
  }
}

/** An error that carries a renderable message. `.message` is English for logs. */
export class AppError extends Error {
  constructor(readonly msg: Msg) {
    super(render(msg, "en"));
  }
}

/** Render any thrown value for a person in `lang`. */
export function errorText(err: unknown, lang: Lang): string {
  if (err instanceof AppError) return render(err.msg, lang);
  return render(msg("common.internal"), lang);
}

/**
 * Recognise English sentences that older versions of this app wrote to the call
 * log before messages were structured, so they can be re-rendered in any language.
 */
export function legacyTextToMsg(text: string): Msg | null {
  const t = text.trim();
  const fixed = Object.entries(CATALOG).find(([, v]) => !v.en.includes("{") && v.en === t);
  if (fixed) return msg(fixed[0] as MsgCode);
  const reasonCode = (en: string): MsgCode | null => {
    const hit = Object.entries(CATALOG).find(([k, v]) => k.startsWith("reason.") && v.en === en.trim());
    return hit ? (hit[0] as MsgCode) : null;
  };
  let m = /^Blocked: this endpoint (.+)\. Ask the guardian, then retry with confirm: true\.$/.exec(t);
  if (m) {
    const codes = m[1]!.split("; ").map(reasonCode);
    if (codes.every((c): c is MsgCode => c !== null)) return msg("call.blocked", { reasons: codes.map((c) => msg(c)) });
  }
  m = /^Missing required parameter\(s\): (.+)\. Nothing was sent \(no credits spent\)\.$/.exec(t);
  if (m) return msg("call.missingParams", { params: m[1]! });
  m = /^Missing path parameter "(.+)"$/.exec(t);
  if (m) return msg("config.missingPathParam", { name: m[1]! });
  return null;
}

export const __catalog = CATALOG;
