import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";

const log = createAppLogger("teach_send_review_nudge");

// Channels send_message accepts. Anything else (or an unset channel) falls back.
const VALID_CHANNELS = new Set([
  "telegram",
  "telegram_user",
  "whatsapp",
  "wechat",
  "discord",
  "webchat",
  "email",
]);

const schema = z.object({
  dry_run: z
    .boolean()
    .optional()
    .describe("Preview the nudge messages without actually sending them"),
});

interface MissionGroup {
  missionId: string;
  title: string;
  dueCount: number;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const dryRun = input.dry_run ?? false;
      const repo = createTeachRepository(deps.appContext.db);
      const settings = repo.getSettings();

      const dueResult = await deps.appContext.runAction("teach_find_due_reviews", {});
      if (dueResult.status !== "ok") {
        const reason =
          dueResult.status === "error" ? dueResult.error : `find_due_reviews returned ${dueResult.status}`;
        return { status: "error", error: reason };
      }
      const data = dueResult.data as { totalDue: number; missions: MissionGroup[] };

      // Empty due queue → send nothing (no spammy "0 due" pings).
      if (!data.totalDue) {
        log.info("no reviews due; sending nothing");
        return { status: "ok", data: { sent: false, totalDue: 0, messages: [] } };
      }

      // Single app-global channel for all nudges (the per-mission override was
      // removed). Fall back to webchat if the configured channel is unknown.
      const channel = VALID_CHANNELS.has(settings.defaultNotifyChannel)
        ? settings.defaultNotifyChannel
        : "webchat";

      const messages: Array<{ channel: string; text: string; sent: boolean; error?: string }> = [];

      // One combined nudge covering every mission with due cards.
      {
        const missions = data.missions;
        const total = missions.reduce((a, m) => a + m.dueCount, 0);
        const lines = [
          `📚 Teach: you have ${pluralize(total, "card")} due for review.`,
          "",
          ...missions.map((m) => `• ${m.title} — ${pluralize(m.dueCount, "card")}`),
          "",
          "Open Teach to review: /apps/teach",
        ];
        const text = lines.join("\n");

        if (dryRun) {
          messages.push({ channel, text, sent: false });
          return {
            status: "ok",
            data: { sent: false, dryRun, totalDue: data.totalDue, messages },
          };
        }

        try {
          const res = await deps.appContext.runAction("send_message", {
            channel,
            to: "guardian",
            text,
          });
          if (res.status !== "ok") {
            const reason = res.status === "error" ? res.error : `send_message returned ${res.status}`;
            // Fall back to webchat if a configured channel failed.
            if (channel !== "webchat") {
              const fb = await deps.appContext.runAction("send_message", {
                channel: "webchat",
                to: "guardian",
                text,
              });
              messages.push({
                channel: "webchat",
                text,
                sent: fb.status === "ok",
                error: fb.status === "ok" ? undefined : `primary(${channel}) failed: ${reason}`,
              });
            } else {
              messages.push({ channel, text, sent: false, error: reason });
            }
          } else {
            messages.push({ channel, text, sent: true });
          }
        } catch (err) {
          messages.push({
            channel,
            text,
            sent: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const sentCount = messages.filter((m) => m.sent).length;
      log.info("review nudge processed", { totalDue: data.totalDue, dryRun, sentCount });
      return {
        status: "ok",
        data: { sent: !dryRun && sentCount > 0, dryRun, totalDue: data.totalDue, messages },
      };
    },
  });
}
