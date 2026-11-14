import { defineAction, z, type Action, type ActionConfig, type AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { truncateForAgent } from "../../lib/shape.js";
import { msg, render } from "../../lib/messages.js";
import { guardedResult } from "../../lib/runtime.js";

const schema = z.object({
  days: z.number().int().min(1).max(90).default(7).describe("Days of local call stats to include"),
  tzOffsetMinutes: z.number().int().default(480).describe("UTC offset in minutes for day buckets (default +480, Asia/Shanghai)"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: ({ days, tzOffsetMinutes }) =>
      guardedResult(deps, async (svc) => {
        const settings = svc.publicSettings();
        const local = svc.stats(days, tzOffsetMinutes);
        if (!settings.configured) {
          return { status: "ok", data: { configured: false, message: render(msg("config.noKey"), svc.lang), localStats: local } };
        }
        const acct = await svc.account();
        if (!acct.ok) return { status: "error", error: acct.error ?? render(msg("common.unknown"), svc.lang) };
        const user = acct.user;
        return { status: "ok", data: {
          configured: true,
          baseUrl: settings.baseUrl,
          ok: acct.ok,
          error: acct.error,
          user: acct.user ? user : null,
          apiKey: acct.apiKey,
          tikhubDailyUsage: truncateForAgent(acct.dailyUsage, 8000).value,
          dailyUsageError: acct.dailyUsageError,
          localStats: local,
        } };
      }),
  });
}
