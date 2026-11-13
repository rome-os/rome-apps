import { randomUUID } from "node:crypto";
import {
  getCurrentActionContext,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import {
  parseView,
  viewSchema,
  inspectView,
  resolveView,
} from "./agentView.js";
import { selectionStore, validChatId } from "./selectionStore.js";
import { GitError } from "./git.js";
/** Runtime SDK 0.11.3 on npm predates show_widget; the running host and its
 * app-runtime source already document/handle this public envelope. Keep the
 * compatibility type explicit, never masquerade a card as ok/pending input. */
export interface ComponentCardResult {
  status: "show_widget";
  widget: { componentId: string; props: Record<string, unknown>; text: string };
}
export interface DiffviewAction extends Omit<Action, "execute"> {
  execute(
    args: Record<string, unknown>,
  ): Promise<ActionResult | ComponentCardResult>;
}
export function createViewAction(
  operation: "select" | "inspect" | "card",
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): DiffviewAction {
  return {
    config,
    inputSchema: viewSchema,
    async execute(raw) {
      try {
        const caller = getCurrentActionContext();
        if (caller?.actorKind !== "guardian") throw new GitError("forbidden");
        const channel = caller.channelContext;
        const chat =
          channel?.romeSessionId ||
          (channel?.channel === "webchat" ? channel.threadId : undefined);
        const store = selectionStore(deps.appContext.db);
        // Capture BEFORE async Git validation. A later manual choice must win.
        const prior =
          operation === "select" ? store.read(validChatId(chat || "")) : null;
        const input = parseView(raw);
        if (operation === "select") {
          const { state } = await resolveView(input);
          return {
            status: "ok",
            data: {
              chatId: chat,
              ...store.write(chat!, state, prior!.revision),
              focusChanged: false,
            },
          };
        }
        const card = await inspectView(input);
        if (operation === "inspect") return { status: "ok", data: card };
        const id = randomUUID();
        store.putCard(id, chat ? validChatId(chat) : null, card);
        return {
          status: "show_widget",
          widget: {
            componentId: "comparison-card",
            props: { cardId: id },
            text: JSON.stringify({ cardId: id, ...card }),
          },
        };
      } catch (e) {
        return {
          status: "error",
          error: e instanceof GitError ? e.code : "internal",
        };
      }
    },
  };
}
