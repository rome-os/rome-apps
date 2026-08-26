import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import {
  DEFAULT_LINE_LIMIT,
  isAllowedDiscordAttachmentUrl,
  readAttachmentLines,
} from "../../attachments/extract.js";

const log = createAppLogger("discord-digest_read_attachment");

interface ReadAttachmentInput {
  url?: string;
  fileName?: string;
  mimeType?: string;
  offset?: number;
  limit?: number;
}

export function createAction(config: ActionConfig, _deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The Discord CDN attachment URL (cdn.discordapp.com or media.discordapp.net) to read.",
        },
        fileName: {
          type: "string",
          description: "Original file name; used to infer the file type when the URL/mime is ambiguous.",
        },
        mimeType: {
          type: "string",
          description: "Attachment content type, if known.",
        },
        offset: {
          type: "number",
          description: "1-based line number to start reading from (default 1). Use with a previous call's endLine to page through a large file.",
        },
        limit: {
          type: "number",
          description: `Maximum number of lines to return (default ${DEFAULT_LINE_LIMIT}). Returned text is also capped in size; check hasMore to decide whether to read further.`,
        },
      },
      additionalProperties: false,
    },

    async execute(rawInput: Record<string, unknown>): Promise<ActionResult> {
      const input = rawInput as ReadAttachmentInput;
      const url = input.url?.trim();

      if (!url) {
        return { status: "ok", data: { ok: false, reason: "missing_url" } };
      }
      if (!isAllowedDiscordAttachmentUrl(url)) {
        log.warn("rejected non-allowlisted attachment url");
        return { status: "ok", data: { ok: false, reason: "url_not_allowed" } };
      }

      try {
        const result = await readAttachmentLines(
          { url, fileName: input.fileName, mimeType: input.mimeType },
          typeof input.offset === "number" ? input.offset : 1,
          typeof input.limit === "number" ? input.limit : DEFAULT_LINE_LIMIT,
        );
        if (!result) {
          return { status: "ok", data: { ok: false, reason: "unreadable_or_unsupported" } };
        }
        return {
          status: "ok",
          data: {
            ok: true,
            text: result.text,
            startLine: result.startLine,
            endLine: result.endLine,
            totalLines: result.totalLines,
            hasMore: result.hasMore,
            sourceTruncated: result.sourceTruncated,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("attachment extraction failed", { error: message });
        return { status: "ok", data: { ok: false, reason: "extraction_failed" } };
      }
    },
  };
}
