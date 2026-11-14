import { defineAction, z, type Action, type ActionConfig, type AppActionRuntimeDeps } from "@rome-os/app-runtime";
import { AppError, msg, render } from "../../lib/messages.js";
import { guarded } from "../../lib/runtime.js";

const schema = z.object({
  path: z.string().trim().min(1).describe("Endpoint path, e.g. /api/v1/xiaohongshu/app_v2/get_note_info"),
  method: z.string().optional().describe("GET or POST; defaults to the documented method"),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: ({ path, method }) =>
      guarded(deps, async (svc) => {
        const res = await svc.inspect({ path, method });
        if ("error" in res) {
          const hint = res.suggestions?.length
            ? `\n${render(msg("inspect.didYouMean", { list: res.suggestions.map((s) => `${s.method} ${s.path}`).join(", ") }), svc.lang)}`
            : "";
          throw new AppError(msg("inspect.failure", { detail: `${res.error}${hint}` }));
        }
        const { description: _full, operationId: _id, briefZh: _zh, ...rest } = res;
        const reasons = res.safety.reasons.join(svc.lang === "zh" ? "；" : "; ");
        return {
          ...rest,
          method: rest.method.toUpperCase(),
          guarded: res.safety.sensitive,
          next: render(res.safety.sensitive ? msg("hint.inspectGuarded", { reasons }) : msg("hint.inspectNext"), svc.lang),
        };
      }),
  });
}
