import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";

const log = createAppLogger("teach_setup_review_routine");

const REVIEW_ROUTINE_NAME = "teach-daily-review";

const schema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe("Whether the routine is live. Defaults to false — opt in explicitly to start daily nudges."),
  daily_review_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe("Local time HH:mm for the daily nudge (e.g. 09:00)"),
  timezone: z.string().trim().optional().describe("IANA timezone, e.g. America/Los_Angeles"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      const settings = repo.updateSettings({
        ...(input.daily_review_time ? { dailyReviewTime: input.daily_review_time } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      });

      const enabled = input.enabled ?? false;

      // Replace any existing routine so schedule/enabled changes take effect
      // (there is no in-place update action).
      try {
        const routines = await deps.appContext.listRoutines();
        for (const r of routines.filter((r) => r.name === REVIEW_ROUTINE_NAME)) {
          await deps.appContext.runAction("delete_routine", { routineId: r.id });
        }
      } catch (err) {
        log.warn("could not clear existing routine", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const createResult = await deps.appContext.runAction("create_routine", {
        name: REVIEW_ROUTINE_NAME,
        trigger: {
          type: "schedule",
          tzid: settings.timezone,
          localTime: settings.dailyReviewTime,
          rrule: "FREQ=DAILY",
        },
        actionName: "teach_send_review_nudge",
        args: {},
        enabled,
      });

      if (createResult.status !== "ok") {
        const reason =
          createResult.status === "error"
            ? createResult.error
            : `create_routine returned ${createResult.status}`;
        return { status: "error", error: `Failed to create routine: ${reason}` };
      }

      log.info("review routine configured", {
        enabled,
        time: settings.dailyReviewTime,
        tz: settings.timezone,
      });
      return {
        status: "ok",
        data: {
          routine: REVIEW_ROUTINE_NAME,
          enabled,
          dailyReviewTime: settings.dailyReviewTime,
          timezone: settings.timezone,
          defaultNotifyChannel: settings.defaultNotifyChannel,
        },
      };
    },
  });
}
