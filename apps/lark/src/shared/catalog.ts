export type Identity = "user" | "bot";
export interface FieldSpec {
  type: "string" | "integer";
  label: [string, string];
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  default?: string | number;
  stdin?: boolean;
}
export interface CommandSpec {
  id: string;
  coreOperation?: string;
  argv: string[];
  domain: string;
  title: [string, string];
  description: [string, string];
  risk: "read" | "write";
  identities: Identity[];
  fields: Record<string, FieldSpec>;
  fixed?: Record<string, string>;
  example: Record<string, unknown>;
}
function text(zh: string, en: string, required = false, max = 500): FieldSpec {
  return { type: "string", label: [zh, en], required, max };
}
function choice(
  zh: string,
  en: string,
  values: string[],
  def?: string,
): FieldSpec {
  return { type: "string", label: [zh, en], enum: values, default: def };
}
function integer(
  zh: string,
  en: string,
  min: number,
  max: number,
  def?: number,
): FieldSpec {
  return { type: "integer", label: [zh, en], min, max, default: def };
}
const paging = {
  "page-size": integer("每页数量", "Page size", 1, 20, 15),
  "page-token": text("分页游标", "Page cursor", false, 4000),
};
const period = {
  start: text("开始时间（含时区）", "Start (with timezone)"),
  end: text("结束时间（含时区）", "End (with timezone)"),
};
const calendar = {
  "calendar-id": text(
    "日历 ID（默认 primary）",
    "Calendar ID (default primary)",
  ),
};
const base = { "base-token": text("多维表格标识", "Base token", true) };
const table = {
  ...base,
  "table-id": text("数据表 ID 或名称", "Table ID or name", true),
};
export const SCOPE_OPERATION = "feishu.scopes.list";
const coreOperations: Readonly<Record<string, string | undefined>> = {
  "docs.fetch": "feishu.document.read",
  "docs.create": "feishu.document.create",
  "docs.update": "feishu.document.update",
  "drive.inspect": "feishu.drive.inspect",
  "wiki.spaces": "feishu.wiki.spaces",
  "wiki.node": "feishu.wiki.node.get",
  "wiki.nodes": "feishu.wiki.nodes.list",
  "base.get": "feishu.base.get",
  "base.tables": "feishu.base.tables.list",
  "base.fields": "feishu.base.fields.list",
  "base.records": "feishu.base.records.list",
  "sheets.info": "feishu.sheets.info",
  "sheets.cells": "feishu.sheets.cells.read",
  "calendar.agenda": "feishu.calendar.events.list",
  "calendar.get": "feishu.calendar.event.get",
  "calendar.search": "feishu.calendar.events.search",
  "calendar.create": "feishu.calendar.event.create",
  "im.history": "feishu.im.messages.list",
};
function command(
  id: string,
  argv: string[],
  title: [string, string],
  fields: Record<string, FieldSpec>,
  example: Record<string, unknown>,
  extra: Partial<CommandSpec> = {},
): CommandSpec {
  return {
    id,
    argv,
    coreOperation: coreOperations[id],
    domain: argv[0]!,
    title,
    description: title,
    risk: "read",
    identities: ["user", "bot"],
    fields,
    example,
    ...extra,
  };
}
export const COMMANDS: CommandSpec[] = [
  command(
    "docs.search",
    ["docs", "+search"],
    ["搜索文档", "Search documents"],
    { query: text("关键词", "Query", true), ...paging },
    { query: "项目计划" },
    { identities: ["user"] },
  ),
  command(
    "docs.fetch",
    ["docs", "+fetch"],
    ["读取文档", "Read a document"],
    {
      doc: text("文档链接或标识", "Document URL or token", true),
      scope: choice(
        "读取范围",
        "Read scope",
        ["full", "outline", "keyword"],
        "full",
      ),
      keyword: text("关键词", "Keyword"),
    },
    { doc: "https://example.feishu.cn/docx/Document123" },
    { fixed: { "doc-format": "markdown" } },
  ),
  command(
    "drive.inspect",
    ["drive", "+inspect"],
    ["识别资料链接", "Inspect a resource URL"],
    {
      url: text("飞书资料链接", "Lark resource URL", true),
      type: choice(
        "资源类型（纯标识必填）",
        "Type (required for bare tokens)",
        [
          "doc",
          "docx",
          "sheet",
          "bitable",
          "wiki",
          "file",
          "folder",
          "mindnote",
          "slides",
        ],
      ),
    },
    { url: "https://example.feishu.cn/wiki/replace-me" },
  ),
  command(
    "wiki.spaces",
    ["wiki", "+space-list"],
    ["列出知识空间", "List wiki spaces"],
    { ...paging },
    {},
  ),
  command(
    "wiki.node",
    ["wiki", "+node-get"],
    ["解析知识库节点", "Resolve a wiki node"],
    {
      "node-token": text(
        "知识库链接或节点标识",
        "Wiki URL or node token",
        true,
      ),
    },
    { "node-token": "https://example.feishu.cn/wiki/replace-me" },
  ),
  command(
    "wiki.nodes",
    ["wiki", "+node-list"],
    ["列出知识库节点", "List wiki nodes"],
    {
      "space-id": text("知识空间 ID", "Space ID", true),
      "parent-node-token": text("父节点标识", "Parent node token"),
      ...paging,
    },
    { "space-id": "my_library" },
  ),
  command(
    "calendar.agenda",
    ["calendar", "+agenda"],
    ["查看日程", "View agenda"],
    { ...calendar, ...period },
    {},
  ),
  command(
    "calendar.get",
    ["calendar", "+get"],
    ["读取日程详情", "Get an event"],
    { ...calendar, "event-id": text("日程 ID", "Event ID", true) },
    { "event-id": "replace-me" },
  ),
  command(
    "calendar.search",
    ["calendar", "+search-event"],
    ["搜索日程", "Search events"],
    { ...calendar, ...period, query: text("关键词", "Query", true), ...paging },
    { query: "评审" },
  ),
  command(
    "base.get",
    ["base", "+base-get"],
    ["读取多维表格信息", "Get a Base"],
    { ...base },
    { "base-token": "replace-me" },
  ),
  command(
    "base.tables",
    ["base", "+table-list"],
    ["列出数据表", "List Base tables"],
    { ...base },
    { "base-token": "replace-me" },
  ),
  command(
    "base.fields",
    ["base", "+field-list"],
    ["列出字段", "List table fields"],
    { ...table },
    { "base-token": "replace-me", "table-id": "tbl_replace_me" },
  ),
  command(
    "base.records",
    ["base", "+record-list"],
    ["读取表格记录", "Read table records"],
    {
      ...table,
      "view-id": text("视图 ID 或名称", "View ID or name"),
      limit: integer("记录上限", "Record limit", 1, 200, 50),
      offset: integer("偏移量", "Offset", 0, 1000000, 0),
    },
    { "base-token": "replace-me", "table-id": "tbl_replace_me", limit: 50 },
    { fixed: { format: "json" } },
  ),
  command(
    "sheets.info",
    ["sheets", "+workbook-info"],
    ["读取电子表格结构", "Inspect a spreadsheet"],
    { url: text("电子表格链接", "Spreadsheet URL", true) },
    { url: "https://example.feishu.cn/sheets/replace-me" },
  ),
  command(
    "sheets.cells",
    ["sheets", "+cells-get"],
    ["读取单元格", "Read cells"],
    {
      url: text("电子表格链接", "Spreadsheet URL", true),
      "sheet-id": text("子表 ID", "Sheet ID", true),
      range: text("单元格范围（A1:F20）", "Cell range (A1:F20)", true),
      "max-chars": integer(
        "输出字符上限",
        "Output character limit",
        1000,
        80000,
        25000,
      ),
    },
    {
      url: "https://example.feishu.cn/sheets/replace-me",
      "sheet-id": "replace-me",
      range: "A1:F20",
    },
  ),
  command(
    "im.search",
    ["im", "+messages-search"],
    ["搜索消息", "Search messages"],
    {
      query: text("关键词", "Query", true),
      "chat-id": text("限制到聊天 ID", "Restrict to chat ID"),
      ...period,
      ...paging,
    },
    { query: "项目评审" },
    { identities: ["user"] },
  ),
  command(
    "im.history",
    ["im", "+chat-messages-list"],
    ["读取聊天历史", "Read chat history"],
    {
      "chat-id": text("聊天 ID", "Chat ID", true),
      ...period,
      ...paging,
      order: choice("时间顺序", "Order", ["asc", "desc"], "desc"),
    },
    { "chat-id": "oc_replace_me", "page-size": 15 },
  ),
  command(
    "docs.create",
    ["docs", "+create"],
    ["创建文档", "Create a document"],
    {
      title: text("标题", "Title", true),
      content: {
        ...text("Markdown 正文", "Markdown body", true, 16000),
        stdin: true,
      },
      "parent-token": text(
        "目标文件夹或知识库节点标识",
        "Parent folder or wiki node token",
      ),
    },
    { title: "项目笔记", content: "# 项目笔记\n待补充" },
    { risk: "write", fixed: { "doc-format": "markdown" } },
  ),
  command(
    "docs.update",
    ["docs", "+update"],
    ["更新文档", "Update a document"],
    {
      doc: text("文档链接或标识", "Document URL or token", true),
      command: {
        ...choice("更新方式", "Update mode", ["append", "overwrite"]),
        required: true,
      },
      content: {
        ...text("Markdown 正文", "Markdown body", true, 16000),
        stdin: true,
      },
    },
    { doc: "Document123", command: "append", content: "\n## 更新\n补充说明" },
    { risk: "write", fixed: { "doc-format": "markdown" } },
  ),
  command(
    "calendar.create",
    ["calendar", "+create"],
    ["创建日程", "Create an event"],
    {
      ...calendar,
      summary: text("日程标题", "Event title", true),
      start: text(
        "开始时间（ISO 8601，含时区）",
        "Start (ISO 8601 with timezone)",
        true,
      ),
      end: text(
        "结束时间（ISO 8601，含时区）",
        "End (ISO 8601 with timezone)",
        true,
      ),
      "attendee-ids": text(
        "参会人 ID（逗号分隔）",
        "Attendee IDs (comma-separated)",
      ),
    },
    {
      summary: "项目评审",
      start: "2026-11-01T14:00:00+08:00",
      end: "2026-11-01T15:00:00+08:00",
    },
    { risk: "write" },
  ),
  command(
    "im.send_as_user",
    ["im", "+messages-send"],
    ["以本人身份发消息", "Send as yourself"],
    {
      "chat-id": text("目标聊天 ID", "Target chat ID", true),
      text: {
        ...text("纯文本消息", "Plain text message", true, 8000),
        stdin: true,
      },
    },
    { "chat-id": "oc_replace_me", text: "请查收项目文档。" },
    {
      risk: "write",
      identities: ["user"],
      description: [
        "仅本人身份；普通机器人通知请使用 Rome 消息通道。",
        "User identity only. Use Rome messaging for ordinary bot notifications.",
      ],
    },
  ),
];
// The CLI shortcuts and Core operations have different pagination and text contracts.
export function coreCommand(spec: CommandSpec): CommandSpec {
  const fields = { ...spec.fields };
  let example = spec.example;
  const pageMax: Record<string, number> = {
    "wiki.spaces": 50,
    "wiki.nodes": 50,
    "im.history": 50,
    "calendar.search": 50,
    "base.tables": 100,
    "base.fields": 100,
    "base.records": 200,
  };
  if (pageMax[spec.id]) {
    fields["page-size"] = integer(
      "每页数量",
      "Page size",
      1,
      pageMax[spec.id]!,
    );
    fields["page-token"] = paging["page-token"];
  }
  if (spec.id === "calendar.agenda") {
    fields["page-size"] = integer("每页数量", "Page size", 50, 200, 50);
    fields["page-token"] = text(
      "分页游标（仅在未指定 start 或 end 时使用）",
      "Page cursor (use only when start and end are omitted)",
      false,
      4000,
    );
  }
  if (spec.id === "base.records") {
    delete fields.limit;
    delete fields.offset;
    example = { "base-token": "app123", "table-id": "tbl123", "page-size": 50 };
  }
  if (fields["table-id"])
    fields["table-id"] = text("数据表 ID", "Table ID", true);
  if (fields["view-id"]) fields["view-id"] = text("视图 ID", "View ID");
  if (spec.id === "docs.create" || spec.id === "docs.update") {
    fields.content = text(
      "纯文本正文",
      "Plain text content",
      spec.id === "docs.update",
      16000,
    );
    if (fields.title) fields.title = text("标题", "Title", true, 200);
    if (fields["parent-token"])
      fields["parent-token"] = text("目标文件夹标识", "Folder token");
  }
  if (spec.id === "calendar.create") {
    fields.summary = text("日程标题", "Event title", true, 200);
    fields.description = text("日程说明", "Description", false, 4000);
    fields["attendee-ids"] = text(
      "参会人 Open ID（逗号分隔，最多 20 个）",
      "Attendee open IDs (comma-separated, up to 20)",
      false,
      2600,
    );
  }
  if (spec.id === "calendar.search")
    fields.query = text("关键词", "Query", true, 200);
  if (spec.id === "sheets.cells")
    fields["max-chars"] = integer(
      "输出字符上限",
      "Output character limit",
      1,
      80000,
      25000,
    );
  return { ...spec, fields, example };
}

export const CLI_VERSION = "1.0.98";
export const AUTH_SCOPE_GROUPS = {
  docs: ["search:docs:read", "docx:document:readonly"],
  wiki: ["wiki:node:retrieve", "wiki:space:retrieve"],
  sheets: ["sheets:spreadsheet:read"],
  calendar: ["calendar:calendar.event:read"],
  base: [
    "base:app:read",
    "base:table:read",
    "base:field:read",
    "base:record:read",
  ],
  // These are explicit scope requests, not the CLI's broad --recommend preset.
  im: [
    "search:message",
    "im:message.group_msg:get_as_user",
    "im:message.p2p_msg:get_as_user",
    "im:message.reactions:read",
  ],
  write_im: ["im:message.send_as_user"],
  write_docs: ["docx:document:create", "docx:document:write_only"],
  write_calendar: [
    "calendar:calendar.event:create",
    "calendar:calendar.event:update",
  ],
};
export function findCommand(id: string): CommandSpec {
  const item = COMMANDS.find((c) => c.id === id);
  if (!item) throw new Error("command_not_allowed");
  return item;
}
export function commandSchema(spec: CommandSpec): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.entries(spec.fields)
      .filter(([, f]) => f.required)
      .map(([k]) => k),
    properties: Object.fromEntries(
      Object.entries(spec.fields).map(([k, f]) => [
        k,
        {
          type: f.type,
          description: f.label[1],
          ...(f.enum ? { enum: f.enum } : {}),
          ...(f.max !== undefined
            ? f.type === "integer"
              ? { maximum: f.max }
              : { maxLength: f.max }
            : {}),
          ...(f.min !== undefined ? { minimum: f.min } : {}),
          ...(f.default !== undefined ? { default: f.default } : {}),
        },
      ]),
    ),
  };
}
