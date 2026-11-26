import { useSyncExternalStore } from "react";
export const M = {
  providerInventoryUnknown: [
    "尚未查询飞书侧权限",
    "Provider scopes not checked",
  ],
  unsupportedUser: [
    "此路径尚不支持用户身份",
    "User identity is not supported on this path",
  ],
  moreConnections: ["加载更多已授权连接", "Load more granted connections"],
  errorScope: [
    "飞书拒绝了所需的应用权限。请在飞书开发者后台核对。",
    "Check the required application scope in the provider console.",
  ],
  errorResource: [
    "飞书拒绝访问该资源，请检查 Bot 的访问权限。",
    "Feishu denied access to this resource. Check the bot’s access.",
  ],
  errorApp: [
    "Core 授权缺失或已失效，请前往 Rome 设置 → 对应飞书连接详情页核对操作授权。",
    "Core access is missing or revoked. Check the operation in Rome Settings → the Feishu connection details.",
  ],
  errorDocument: [
    "资源不存在或标识不正确。",
    "Resource not found. Check its ID.",
  ],
  errorCore: ["Core 连接暂不可用。", "The Core connection is unavailable."],
  errorResponse: [
    "未能获取有效的 Core 响应。",
    "Core did not return a valid response.",
  ],
  coreGrant: [
    "请前往 Rome 设置 → 对应飞书连接详情页，授权此操作",
    "Open Rome Settings → the Feishu connection details and grant this operation",
  ],
  userOnly: [
    "此命令或所选身份需要用户授权。Core 飞书 Bot 当前只支持机器人身份。使用本人身份请显式选择 local-cli，或等待 Core User OAuth 支持。",
    "This command or identity requires user authorization. Choose local-cli explicitly for user access until Core supports User OAuth.",
  ],
  coreApproval: [
    "Core 未提供此写操作所需的审批。",
    "Core approval is unavailable for this write.",
  ],
  scopeFailed: [
    "权限查询失败，无法判断飞书权限。",
    "Scope query failed. Provider grants are unknown.",
  ],
  scopeUnauthorized: [
    "权限查询未获授权，无法判断飞书权限。",
    "The scope query is unauthorized. Provider grants are unknown.",
  ],
  inProgress: [
    "同一请求正在处理，请等待并保留请求 ID。不要换用新 ID。",
    "The request is in progress. Keep the same request ID and wait.",
  ],
  inProgressWriteNote: [
    "请在 Rome 活动中确认原请求已结束，再发起另一项写入。请保留原请求 ID，避免重复提交。",
    "Confirm the original request has finished in Rome Activity before starting another write. Keep its request ID and avoid resubmitting it.",
  ],
  duplicate: [
    "此请求已经处理，请查看原执行记录。",
    "This request was already processed. Check the original execution.",
  ],
  manageAppAccess: [
    "打开 Rome 设置管理操作授权",
    "Manage operation grants in Rome settings",
  ],
  phaseOneScope: [
    "以此连接的 Bot 身份执行已授权的操作。",
    "Run granted operations as this connection’s bot.",
  ],
  resourceAccessProbe: ["检查文档访问", "Check document access"],
  resourceProbeNote: [
    "用所选身份尝试读取一份文档的结构，并丢弃内容。只确认该文档的读取能力，不列出 ACL 成员，也不代表可写。",
    "Read one document outline with the selected identity and discard its content. This checks effective read access only, not ACL membership or write access.",
  ],
  documentUrl: ["文档链接或标识", "Document URL or token"],
  checkDocumentAccess: ["检查读取权限", "Check read access"],
  accessConfirmed: [
    "已确认：可以读取该文档",
    "Confirmed: this document is readable",
  ],
  accessDenied: ["飞书拒绝访问该文档", "Lark denied document access"],
  accessUnknown: [
    "未能确认访问权限，请检查链接或调用错误",
    "Access could not be confirmed; check the URL or request error",
  ],
  copyFailed: [
    "复制失败，请手动选择清单复制",
    "Copy failed; select and copy the list manually",
  ],
  coreNotInstalled: [
    "当前运行的 Rome 核心尚未安装委托接口，不能执行此连接。",
    "This running Core has no delegated API installed; this connection cannot execute.",
  ],
  delegationReady: ["委托接口就绪", "Delegated API ready"],
  queryScopes: ["查询应用权限", "Query application scopes"],
  manageUserConsent: [
    "在 Rome 设置中授权本人身份",
    "Authorize user tools in Rome settings",
  ],
  authorizedUser: ["已授权", "Authorized"],
  userNotAuthorized: ["尚未授权", "Not authorized"],
  userConsentGuidance: [
    "在该连接的 user 授权项中启动流程，填写所需权限，并在飞书确认。不会替换 Bot。",
    "Start the user grant setup on this connection, enter the scopes needed and confirm in Lark. This does not replace the Bot.",
  ],
  filterScopes: ["筛选权限名称…", "Filter scope names…"],
  scopeGranted: ["已授予", "Granted"],
  scopeMissing: ["未授予", "Not granted"],
  emptyScopes: [
    "飞书返回了空的权限清单。",
    "Lark returned an empty scope list.",
  ],
  scopeSnapshotNote: [
    "这是飞书返回的应用所需权限及租户授予状态；未列出的权限不能据此认定已授予。应用权限不代表用户授权或资料访问权限。",
    "Provider-reported requested application scopes and tenant grants. Scopes absent from this list are not proven granted. These are not user consent or resource ACLs.",
  ],
  scopePlan: ["生成申请权限清单", "Plan requested scopes"],
  scopePlanNote: [
    "按用途选择并复制建议申请的权限，到开发者后台核对。它不是已授权清单，也不会自动开通权限。",
    "Select use cases and copy suggested scopes for review in the developer console. This is not a grant snapshot and does not grant permissions.",
  ],
  copyScopes: ["复制申请清单", "Copy request plan"],
  copiedScopes: ["已复制", "Copied"],
  inspectConnection: ["检视连接与权限", "Inspect connection and scopes"],
  clickInspect: ["点击“检视连接与权限”查询", "Use Inspect to query"],
  managedConnections: [
    "Core 已授权此 App 使用的飞书连接",
    "Core-granted Feishu connections",
  ],
  refreshConnections: ["刷新连接状态", "Refresh connections"],
  managedNote: [
    "仅列出 Core 已授权此 App 使用的连接。不读取或复制密钥，实际权限由调用结果确认。",
    "Browse Rome connections. Inspect region, identities and permissions without reading or copying credentials.",
  ],
  delegationPending: [
    "核心委托执行接口尚未接通：这些连接目前仅供检视，不能执行工具。不会自动改用独立 CLI。",
    "Core delegated execution is not available. These connections are inspection-only and cannot execute tools. There is no fallback to the independent CLI.",
  ],
  connectionsUnavailable: [
    "暂时无法读取 Rome 连接；请刷新或打开 Rome 设置。",
    "Cannot load Rome connections. Refresh or open Rome settings.",
  ],
  noManagedConnections: [
    "尚无 Core 已授权此 App 使用的飞书连接。请在 Core 设置中管理 App 文档读取授权。",
    "No Core-granted Feishu connections for this app. Manage app document access in Core settings.",
  ],
  appIdUnavailable: ["应用 ID 未公开", "App ID not exposed"],
  grant_authorized: ["凭据已连接", "Grant connected"],
  grant_unauthorized: ["未连接", "Not connected"],
  grant_degraded: ["需要重新连接", "Reconnect required"],
  grant_unknown: ["凭据状态未知", "Unknown grant state"],
  imCapability: ["IM 能力", "IM capability"],
  coreActCapability: ["核心 Act 能力", "Core Act capability"],
  cap_unlocked: ["就绪", "Ready"],
  cap_unsupported: ["不支持", "Unsupported"],
  "cap_needs-auth": ["需要授权", "Authorization required"],
  cap_disconnected: ["已断开", "Disconnected"],
  cap_connecting: ["连接中", "Connecting"],
  cap_unknown: ["未知", "Unknown"],
  tenantScopes: ["应用权限", "Application scopes"],
  userScopes: ["该应用的用户授权", "User consent for this app"],
  resourceAcl: ["资源访问权限", "Resource access"],
  notInspected: ["尚未实现", "Not implemented"],
  perResource: ["在检视面板检查具体文档", "Check a document in the inspector"],
  feishuConsole: ["飞书权限后台", "Feishu permissions console"],
  larkConsole: ["Lark 权限后台", "Lark permissions console"],
  permissionGuidance: [
    "凭据已连接不代表拥有所有权限。后台修改后可能需要管理员审批或发布版本；用户身份还需在同一应用下单独授权。这里的刷新仅更新 Rome 连接状态，不会检查飞书权限或授予权限。",
    "A connected grant does not imply all permissions. Console changes may need admin approval or publication; user identity requires consent under the same app. Refresh only updates Rome connection state; it does not inspect or grant Lark scopes.",
  ],
  executionConnection: ["执行连接", "Execution connection"],
  localConnection: ["独立 CLI 连接", "Independent CLI connection"],
  inspectionOnly: [
    "仅检视，待核心支持",
    "Inspection only; awaiting Core support",
  ],
  connection: ["连接", "Connection"],
  commands: ["能力目录", "Capabilities"],
  activity: ["调用记录", "Activity"],
  loading: ["正在加载…", "Loading…"],
  error: ["操作失败", "Operation failed"],
  stale: [
    "暂时无法更新，显示上次状态。",
    "Updates unavailable. Showing the last known state.",
  ],
  botTitle: ["聊天通道", "Messaging channel"],
  botNote: [
    "机器人收发消息由 Rome 管理。本 App 不建立第二条 IM 连接。",
    "Rome manages bot messages. This app does not open a second IM connection.",
  ],
  managed: ["由 Rome 管理", "Managed by Rome"],
  settings: ["打开 Rome 设置", "Open Rome settings"],
  toolsTitle: [
    "独立 CLI 连接（可选）",
    "Independent CLI connection (optional)",
  ],
  toolsNote: [
    "独立配置官方 CLI；不会读取或修改 Rome 已保存的机器人凭据。",
    "Configure the official CLI separately. Existing Rome bot credentials stay untouched.",
  ],
  configured: ["已配置", "Configured"],
  notConfigured: ["未配置", "Not configured"],
  user: ["本人身份", "User identity"],
  bot: ["机器人身份", "Bot identity"],
  available: ["可用", "Available"],
  unavailable: ["未授权或不可用", "Not authorized or unavailable"],
  cli: ["官方 CLI", "Official CLI"],
  brand: ["服务区域", "Region"],
  feishu: ["飞书（中国版）", "Feishu (China)"],
  lark: ["Lark（国际版）", "Lark (International)"],
  setup: ["配置飞书应用", "Configure an application"],
  existing: ["使用已有应用", "Use an existing app"],
  newApp: ["创建新应用", "Create a new app"],
  existingNote: [
    "这是独立 CLI 配置。复用 Rome 已有 Bot 请查看上方连接目录，无需在这里重填密钥。",
    "This configures an independent CLI. To reuse an existing Rome bot, use the directory above; do not re-enter its secret here.",
  ],
  appId: ["应用 ID", "App ID"],
  appSecret: ["应用密钥", "App secret"],
  connect: ["配置连接", "Configure connection"],
  createApp: ["前往飞书创建应用", "Create an app in Lark"],
  newNote: [
    "这会创建独立飞书应用，不替换现有 Bot。完成浏览器确认后返回这里。",
    "This creates a separate Lark application without replacing your bot. Return here after browser confirmation.",
  ],
  busy: ["处理中…", "Working…"],
  authorize: ["授权个人工具", "Authorize personal tools"],
  authorizeNote: [
    "仅请求选中的权限。已有 Bot 连接不代表个人文档、日历已授权。",
    "Request only the selected scopes. A connected bot does not authorize your personal documents or calendar.",
  ],
  authorizeButton: ["打开授权流程", "Start authorization"],
  scope_docs: ["文档搜索与读取", "Document search and reading"],
  scope_wiki: ["知识库读取", "Wiki reading"],
  scope_calendar: ["日历读取", "Calendar reading"],
  scope_base: ["多维表格读取", "Base reading"],
  scope_sheets: ["电子表格读取", "Sheets reading"],
  scope_im: ["消息搜索与读取", "Message search and reading"],
  scope_write_docs: ["文档创建与更新", "Document creation and updates"],
  scope_write_calendar: ["日程创建与邀请", "Event creation and invitations"],
  scope_write_im: ["以本人身份发消息", "Send messages as yourself"],
  waiting: ["等待浏览器确认", "Waiting for browser confirmation"],
  openAuth: ["打开飞书确认页面", "Open Lark confirmation"],
  cancel: ["取消流程", "Cancel setup"],
  jobDone: [
    "流程已完成，连接状态将自动更新。",
    "Setup completed. Connection status updates automatically.",
  ],
  jobFailed: [
    "流程未完成，请检查权限或重新发起。",
    "Setup did not complete. Check permissions or start again.",
  ],
  jobInterrupted: [
    "流程因重启中断，请重新发起。",
    "Setup was interrupted by a restart. Start again.",
  ],
  permissions: ["Agent 使用权限", "Agent access"],
  enableAgent: ["允许 Agent 使用工具", "Allow agent tool access"],
  privateOnly: [
    "仅限本人私聊；群聊、非本人及无法确认来源的调用会被拒绝。",
    "Guardian private chats only. Groups, other people and unverified origins are rejected.",
  ],
  enableWrites: ["允许提交写操作审批", "Allow write approval requests"],
  writesNote: [
    "写入必须经 Rome 审批。超时或结果不确定时不会自动重试。",
    "Writes require Rome approval. Timed-out or uncertain writes are not retried automatically.",
  ],
  search: ["搜索能力名称或命令…", "Search capabilities…"],
  all: ["全部", "All"],
  read: ["只读", "Read"],
  write: ["需审批", "Approval required"],
  emptyCommands: ["没有匹配的能力。", "No matching capabilities."],
  selectCommand: [
    "选择左侧能力查看参数。",
    "Select a capability to inspect its parameters.",
  ],
  parameters: ["参数", "Parameters"],
  required: ["必填", "Required"],
  optional: ["可选", "Optional"],
  request: ["调用参数（JSON）", "Request parameters (JSON)"],
  validate: ["校验参数", "Validate parameters"],
  runRead: ["执行读取", "Run read"],
  submitWrite: ["提交审批", "Request approval"],
  result: ["调用结果", "Result"],
  valid: [
    "参数有效，尚未执行。",
    "Parameters are valid. Nothing has been executed.",
  ],
  invalidJson: ["请输入有效的 JSON 对象。", "Enter a valid JSON object."],
  needSetup: [
    "先完成工具连接和所选身份授权，再执行操作。",
    "Configure the tool connection and authorize this identity before execution.",
  ],
  pending: [
    "等待 Rome 审批；尚未向飞书执行写入。",
    "Waiting for Rome approval. No write has been sent to Lark.",
  ],
  review: ["查看 Rome 审批", "Review in Rome"],
  uncertain: [
    "执行结果不确定。请先到飞书检查目标，不要直接重试。",
    "The outcome is uncertain. Inspect the target in Lark before retrying.",
  ],
  newRequest: ["新建请求", "New request"],
  newSeparateRequest: ["发起另一项写入", "Start another write"],
  requestFailed: ["暂时无法完成请求。", "The request could not be completed."],
  singlePage: [
    "读取结果为有界分页；有更多数据时需显式继续，不代表全量。",
    "Reads are bounded pages. Continue explicitly when more data is available.",
  ],
  source: [
    "参数依据官方 CLI v1.0.98 的帮助与源码校验。",
    "Parameters are reviewed against official CLI v1.0.98 help and source.",
  ],
  emptyActivity: [
    "还没有工具调用。前往能力目录检查并执行操作。",
    "No tool calls yet. Inspect and run a capability to begin.",
  ],
  time: ["时间", "Time"],
  operation: ["操作", "Operation"],
  identity: ["身份", "Identity"],
  state: ["状态", "State"],
  completed: ["已完成", "Completed"],
  failed: ["失败", "Failed"],
  unknown: ["结果不确定", "Unknown outcome"],
  running: ["执行中", "Running"],
  noContentStored: [
    "这里只保留操作元数据，不保存消息正文、文档内容或凭据。",
    "Only operation metadata is retained here, not message bodies, document content or credentials.",
  ],
  docs: ["文档", "Documents"],
  drive: ["资料链接", "Resources"],
  wiki: ["知识库", "Wiki"],
  calendar: ["日历", "Calendar"],
  base: ["多维表格", "Base"],
  sheets: ["电子表格", "Sheets"],
  im: ["消息工具", "Messages"],
  authorityError: [
    "此操作仅限本人私聊。",
    "This operation requires a guardian private chat.",
  ],
} as const;
export type MessageKey = keyof typeof M;
function subscribeLocale(change: () => void) {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return () => observer.disconnect();
}
function localeSnapshot() {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "zh"
    : "en";
}
export function useI18n() {
  const locale = useSyncExternalStore(
    subscribeLocale,
    localeSnapshot,
    () => "zh",
  );
  const index = locale === "zh" ? 0 : 1;
  return {
    locale,
    index,
    t: (key: MessageKey) => M[key][index],
    pair: (value: readonly [string, string]) => value[index],
    error: (code: string) => formatError(code, index),
  };
}

export function formatError(message: string, index: 0 | 1) {
  const code = message.split(": ", 1)[0]!;
  if (/^http_\d{3}$/.test(code)) return `${M.requestFailed[index]} (${code})`;
  const keys: Record<string, MessageKey> = {
    provider_scope_required: "errorScope",
    provider_resource_denied: "errorResource",
    access_denied: "errorApp",
    authorization_required: "errorApp",
    resource_denied: "errorApp",
    provider_not_found: "errorDocument",
    connection_not_found: "errorApp",
    core_operation_not_granted: "coreGrant",
    core_user_identity_unsupported: "userOnly",
    core_approval_unavailable: "coreApproval",
    outcome_unknown: "uncertain",
    request_in_progress: "inProgress",
    request_failed: "requestFailed",
    core_gateway_unavailable: "errorCore",
    connection_unavailable: "errorCore",
    connection_unhealthy: "errorCore",
    capability_unavailable: "errorCore",
    operation_not_found: "errorCore",
    provider_unavailable: "errorCore",
    provider_response_too_large: "errorResponse",
    provider_response_invalid: "errorResponse",
    incomplete_operation_list: "errorResponse",
    invalid_core_response: "errorResponse",
    provider_error: "errorResponse",
  };
  return keys[code] ? `${M[keys[code]!][index]} (${code})` : message;
}
