import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { DEFAULT_LINK_LINE_LIMIT, readLink, type LinkReadMode } from "../../links/read.js";

const log = createAppLogger("discord-digest_read_link");

interface ReadLinkInput {
  url?: string;
  mode?: LinkReadMode;
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
          description: "The public http(s) URL shared in Discord to inspect. Private/local hosts and credential-bearing URLs are rejected.",
        },
        mode: {
          type: "string",
          enum: ["metadata", "excerpt"],
          description: "metadata returns title/description/content-type only; excerpt returns readable text lines for HTML/text/PDF when available. Default: metadata.",
        },
        offset: {
          type: "number",
          description: "For mode=excerpt, 1-based line number to start reading from (default 1). Use a previous endLine to page progressively.",
        },
        limit: {
          type: "number",
          description: `For mode=excerpt, maximum number of lines to return (default ${DEFAULT_LINK_LINE_LIMIT}). Returned text is also capped in size; check hasMore to decide whether to read further.`,
        },
      },
      additionalProperties: false,
    },

    async execute(rawInput: Record<string, unknown>): Promise<ActionResult> {
      const input = rawInput as ReadLinkInput;
      const url = input.url?.trim();
      if (!url) return { status: "ok", data: { ok: false, reason: "missing_url" } };

      try {
        const result = await readLink({
          url,
          mode: input.mode,
          offset: typeof input.offset === "number" ? input.offset : undefined,
          limit: typeof input.limit === "number" ? input.limit : undefined,
        });
        return { status: "ok", data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("link inspection failed", { error: message });
        return { status: "ok", data: { ok: false, reason: "inspection_failed" } };
      }
    },
  };
}
