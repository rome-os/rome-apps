import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";

const log = createAppLogger("teach_update_settings");

const REVIEW_ROUTINE_NAME = "teach-daily-review";

// The single app-global channel set (the per-mission override was removed).
const NOTIFY_CHANNELS = [
  "telegram",
  "whatsapp",
  "wechat",
  "discord",
  "webchat",
  "email",
] as const;

const schema = z.object({
  notify_channel: z
    .enum(NOTIFY_CHANNELS)
    .optional()
    .describe("The single channel for review nudges (telegram/whatsapp/wechat/discord/webchat/email)"),
  daily_review_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe("Local time HH:mm for the daily review nudge (e.g. 09:00)"),
  timezone: z.string().trim().optional().describe("IANA timezone, e.g. Asia/Shanghai"),
  review_enabled: z
    .boolean()
    .optional()
    .describe("Whether the daily review routine is live. Omit to leave the routine's enabled state unchanged."),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);

      const patch: Partial<{
        defaultNotifyChannel: string;
        dailyReviewTime: string;
        timezone: string;
      }> = {};
      if (input.notify_channel) patch.defaultNotifyChannel = input.notify_channel;
      if (input.daily_review_time) patch.dailyReviewTime = input.daily_review_time;
      if (input.timezone) patch.timezone = input.timezone;

      const settings = repo.updateSettings(patch);

      // Reconcile the daily routine when the schedule or enabled flag is part of
      // this update. setup_review_routine reads the freshly-written time/timezone
      // from settings, so we only need to hand it the desired enabled state.
      let reviewRoutine: { enabled: boolean } | undefined;
      const scheduleTouched =
        input.daily_review_time !== undefined || input.timezone !== undefined;
      if (input.review_enabled !== undefined || scheduleTouched) {
        let enabled = input.review_enabled;
        if (enabled === undefined) {
          // Preserve the routine's current enabled state across a pure
          // schedule change (don't silently turn nudges off).
          try {
            const routines = await deps.appContext.listRoutines();
            const found = routines.find((r) => r.name === REVIEW_ROUTINE_NAME);
            enabled = found ? found.enabled !== false : false;
          } catch {
            enabled = false;
          }
        }
        const res = await deps.appContext.runAction("teach_setup_review_routine", { enabled });
        if (res.status !== "ok") {
          const reason =
            res.status === "error" ? res.error : `setup_review_routine returned ${res.status}`;
          return { status: "error", error: `Settings saved but routine update failed: ${reason}` };
        }
        reviewRoutine = { enabled };
      }

      log.info("settings updated", {
        ...patch,
        routineReconciled: reviewRoutine !== undefined,
      });

      return {
        status: "ok",
        data: {
          settings: {
            defaultNotifyChannel: settings.defaultNotifyChannel,
            dailyReviewTime: settings.dailyReviewTime,
            timezone: settings.timezone,
          },
          reviewRoutine,
        },
      };
    },
  });
}
