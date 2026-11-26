import {
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { COMMANDS } from "../../shared/catalog.js";
export function createAction(
  config: ActionConfig,
  _deps: AppActionRuntimeDeps,
): Action {
  return defineAction({
    config,
    schema: z.object({
      query: z.string().max(200).default(""),
      risk: z.enum(["read", "write"]).optional(),
    }),
    execute: async ({ query, risk }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const items = COMMANDS.filter(
        (c) =>
          (!risk || c.risk === risk) &&
          terms.every((t) =>
            `${c.id} ${c.title.join(" ")} ${c.description.join(" ")}`
              .toLowerCase()
              .includes(t),
          ),
      ).map((c) => ({
        id: c.id,
        title: c.title[1],
        description: c.description[1],
        risk: c.risk,
        coreOperation: c.coreOperation,
        coreAction: c.coreOperation
          ? c.risk === "write"
            ? "lark:core_write"
            : "lark:read"
          : undefined,
        identities: c.identities,
        action: c.risk === "write" ? "lark:write" : "lark:read",
      }));
      return {
        status: "ok",
        data: {
          items,
          count: items.length,
          version: "1.0.98",
          hint: "Inspect a command before executing it. Ordinary bot messages use system:send_message, not Lark CLI.",
        },
      };
    },
  });
}
