import { z } from "@rome-os/app-runtime";
import { LarkError, type Invocation } from "./policy.js";

const tokenPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const docPattern = /^[a-zA-Z0-9]{1,128}$/;
const resourceTypes: Record<string, string> = {
  doc: "doc",
  docs: "doc",
  docx: "docx",
  sheets: "sheet",
  sheet: "sheet",
  base: "bitable",
  bitable: "bitable",
  wiki: "wiki",
  file: "file",
  folder: "folder",
  mindnote: "mindnote",
  slides: "slides",
};

function resource(value: string, expected?: string, explicit?: string) {
  const validate = (token: string, type?: string) => {
    if (
      !type ||
      (expected && type !== expected) ||
      (explicit && type !== explicit)
    )
      throw new LarkError("invalid_resource_type");
    if (!(expected === "docx" ? docPattern : tokenPattern).test(token))
      throw new LarkError("invalid_resource_token");
    return { token, type };
  };
  if (!value.includes("://")) return validate(value, explicit ?? expected);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LarkError("invalid_resource_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(url.hostname)
  )
    throw new LarkError("invalid_resource_url");
  const match = /^\/(?:drive\/)?([a-z]+)\/([a-zA-Z0-9_-]+)\/?$/.exec(
    url.pathname,
  );
  if (!match || !Object.hasOwn(resourceTypes, match[1]!))
    throw new LarkError("invalid_resource_url");
  return validate(match[2]!, resourceTypes[match[1]!]);
}

export function documentIdOf(value: string) {
  return resource(value, "docx").token;
}

// prepareInvocation checks the selected command's fields, required values, sizes and enums.
export function coreInput({
  spec,
  parameters: p,
}: Invocation): Record<string, unknown> {
  function value(key: string) {
    return String(p[key]);
  }
  function checked(key: string, pattern = tokenPattern) {
    const v = value(key);
    if (!pattern.test(v)) throw new LarkError("invalid_parameter", key);
    return v;
  }
  const page = {
    ...(p["page-size"] !== undefined && { pageSize: p["page-size"] }),
    ...(p["page-token"] !== undefined && { pageToken: p["page-token"] }),
  };
  const base = () => ({
    appToken: resource(value("base-token"), "bitable").token,
  });
  const sheet = () => ({
    spreadsheetToken: resource(value("url"), "sheet").token,
  });
  const calendar = () => ({
    calendarId:
      p["calendar-id"] === undefined
        ? "primary"
        : checked("calendar-id", /^(?!\.{1,2}$)[a-zA-Z0-9_.@-]{1,256}$/),
  });
  function time(key: string) {
    const v = value(key);
    if (
      !/^-?[0-9]{1,12}$/.test(v) &&
      !z.iso.datetime({ offset: true }).safeParse(v).success
    )
      throw new LarkError("invalid_parameter", key);
    return v;
  }
  function unixSeconds(raw: string): number {
    if (/^-?[0-9]{1,12}$/.test(raw)) return Number.parseInt(raw, 10);
    return Math.floor(Date.parse(raw) / 1000);
  }
  const period = () => {
    const startTime = p.start !== undefined ? time("start") : undefined;
    const endTime = p.end !== undefined ? time("end") : undefined;
    if (
      startTime !== undefined &&
      endTime !== undefined &&
      unixSeconds(endTime) < unixSeconds(startTime)
    )
      throw new LarkError("invalid_time_range");
    return {
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
    };
  };
  switch (spec.id) {
    case "docs.fetch":
      return { documentId: documentIdOf(value("doc")) };
    case "docs.create":
      return {
        title: p.title,
        ...(p.content !== undefined && { content: p.content }),
        ...(p["parent-token"] !== undefined && {
          folderToken: checked("parent-token"),
        }),
      };
    case "docs.update":
      return {
        documentId: documentIdOf(value("doc")),
        mode: p.command,
        content: p.content,
      };
    case "drive.inspect":
      return resource(value("url"), undefined, p.type as string | undefined);
    case "wiki.spaces":
      return page;
    case "wiki.node":
      return { nodeToken: resource(value("node-token"), "wiki").token };
    case "wiki.nodes":
      return {
        spaceId: checked("space-id"),
        ...(p["parent-node-token"] !== undefined && {
          parentNodeToken: checked("parent-node-token"),
        }),
        ...page,
      };
    case "base.get":
      return base();
    case "base.tables":
      return { ...base(), ...page };
    case "base.fields":
      return { ...base(), tableId: checked("table-id"), ...page };
    case "base.records":
      return {
        ...base(),
        tableId: checked("table-id"),
        ...(p["view-id"] !== undefined && { viewId: checked("view-id") }),
        ...page,
      };
    case "sheets.info":
      return sheet();
    case "sheets.cells":
      return {
        ...sheet(),
        sheetId: checked("sheet-id", /^[a-zA-Z0-9_-]{1,64}$/),
        range: checked(
          "range",
          /^[A-Za-z]{1,4}[0-9]{1,7}(:[A-Za-z]{1,4}[0-9]{1,7})?$/,
        ),
      };
    case "calendar.agenda":
      return { ...calendar(), ...period(), ...page };
    case "calendar.get":
      return {
        ...calendar(),
        eventId: checked("event-id", /^[a-zA-Z0-9_@-]{1,256}$/),
      };
    case "calendar.search":
      return { ...calendar(), query: p.query, ...period(), ...page };
    case "calendar.create": {
      const attendees =
        p["attendee-ids"] === undefined
          ? undefined
          : value("attendee-ids")
              .split(",")
              .map((id) => id.trim());
      if (
        attendees &&
        (attendees.length > 20 ||
          attendees.some((id) => !tokenPattern.test(id)))
      )
        throw new LarkError("invalid_parameter", "attendee-ids");
      return {
        ...calendar(),
        summary: p.summary,
        ...period(),
        ...(p.description !== undefined && { description: p.description }),
        ...(attendees && { attendeeOpenIds: attendees }),
      };
    }
    case "im.history":
      return {
        chatId: checked("chat-id"),
        sortOrder: p.order,
        ...period(),
        ...page,
      };
    default:
      throw new LarkError("core_user_identity_unsupported");
  }
}

const str = z.string();
const opt = str.optional();
const num = z.number().optional();
const wikiNode = z.object({
  spaceId: str,
  nodeToken: str,
  objToken: str,
  objType: str,
  title: opt,
  parentNodeToken: opt,
  hasChild: z.boolean(),
});
const event = z.object({
  eventId: str,
  summary: opt,
  description: opt,
  startTime: opt,
  endTime: opt,
  status: opt,
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), hasMore: z.boolean(), pageToken: opt });
const document = z.object({
  documentId: str,
  content: str,
  format: z.literal("plain_text"),
  complete: z.literal(true),
});
const cells = z.object({
  spreadsheetToken: str,
  sheetId: str,
  range: str,
  resolvedRange: opt,
  revision: num,
  values: z.array(z.array(z.unknown())),
});
export const coreOutputs: Readonly<Record<string, z.ZodType>> = {
  "docs.fetch": z.union([
    document,
    document.extend({
      scope: z.enum(["keyword", "outline"]),
      complete: z.literal(false),
    }),
  ]),
  "docs.create": z.object({
    documentId: str,
    title: str,
    revisionId: num,
    blockCount: z.number(),
  }),
  "docs.update": z.object({
    documentId: str,
    mode: z.enum(["append", "overwrite"]),
    revisionId: num,
    blocksAdded: z.number(),
  }),
  "drive.inspect": z.object({
    token: str,
    type: str,
    title: opt,
    ownerId: opt,
    createTime: opt,
    latestModifyTime: opt,
    url: opt,
  }),
  "wiki.spaces": page(
    z.object({
      spaceId: str,
      name: opt,
      description: opt,
      spaceType: opt,
      visibility: opt,
    }),
  ),
  "wiki.node": wikiNode.extend({ nodeType: opt }),
  "wiki.nodes": page(wikiNode),
  "base.get": z.object({
    appToken: str,
    name: opt,
    revision: num,
    timeZone: opt,
  }),
  "base.tables": page(z.object({ tableId: str, name: opt, revision: num })),
  "base.fields": page(
    z.object({
      fieldId: str,
      fieldName: str,
      type: z.number(),
      uiType: opt,
      isPrimary: z.boolean().optional(),
    }),
  ),
  "base.records": page(
    z.object({ recordId: str, fields: z.record(str, z.unknown()) }),
  ).extend({ total: num }),
  "sheets.info": z.object({
    spreadsheetToken: str,
    title: opt,
    url: opt,
    sheets: z.array(
      z.object({
        sheetId: str,
        title: opt,
        index: num,
        rowCount: num,
        columnCount: num,
        hidden: z.boolean().optional(),
      }),
    ),
  }),
  "sheets.cells": z.union([
    cells,
    cells.omit({ values: true }).extend({
      truncated: z.literal(true),
      originalChars: z.number(),
      maxChars: z.number(),
      valuesPreview: str,
    }),
  ]),
  "calendar.agenda": page(event.extend({ organizerCalendarId: opt })).extend({
    calendarId: str,
  }),
  "calendar.get": event.extend({ calendarId: str, location: opt, url: opt }),
  "calendar.search": page(event).extend({ calendarId: str }),
  "calendar.create": z.object({
    calendarId: str,
    eventId: str,
    summary: str,
    startTime: str,
    endTime: str,
    url: opt,
    attendeesAdded: num,
  }),
  "im.history": page(
    z.object({
      messageId: str,
      rootId: opt,
      parentId: opt,
      msgType: str,
      createTime: str,
      updateTime: opt,
      sender: z.object({ id: opt, idType: opt, senderType: opt }).optional(),
      bodyContent: str,
    }),
  ).extend({ chatId: str }),
};

export function coreOutput(
  call: Invocation,
  input: Record<string, unknown>,
  data: unknown,
) {
  if (call.spec.id === "docs.fetch") {
    const parsed = document.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.documentId !== input.documentId ||
      Buffer.byteLength(parsed.data.content) > 128 * 1024
    )
      throw new LarkError("invalid_core_response");
    const doc = parsed.data;
    const scope = call.parameters.scope;
    if (scope === "full") return doc;
    const lines = doc.content.split(/\r?\n/);
    const keyword = String(call.parameters.keyword).toLowerCase();
    const selected = lines.filter((line, i) =>
      scope === "keyword"
        ? line.toLowerCase().includes(keyword)
        : line.trim() &&
          (/^\s*(?:#{1,6}\s+|\d+(?:\.\d+)*[.)、]\s*|第[一二三四五六七八九十百\d]+[章节篇]|[一二三四五六七八九十]+、)/.test(
            line,
          ) ||
            /^\s*(?:=+|-+)\s*$/.test(lines[i + 1] ?? "")),
    );
    return { ...doc, scope, complete: false, content: selected.join("\n") };
  }
  if (call.spec.id === "sheets.cells") {
    const parsed = cells.safeParse(data);
    if (!parsed.success) throw new LarkError("invalid_core_response");
    const { values, ...meta } = parsed.data;
    const limit = Number(call.parameters["max-chars"]);
    const serialized = JSON.stringify(values);
    return serialized.length <= limit
      ? parsed.data
      : {
          ...meta,
          truncated: true,
          originalChars: serialized.length,
          maxChars: limit,
          valuesPreview: serialized.slice(0, limit),
        };
  }
  const parsed = coreOutputs[call.spec.id]?.safeParse(data);
  if (!parsed?.success) throw new LarkError("invalid_core_response");
  return parsed.data;
}
