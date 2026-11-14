import { getCurrentActionContext, type ActionResult, type AppActionRuntimeDeps, type AppRuntimeRepositories, type CurrentActionContext } from "@rome-os/app-runtime";
import { AppError, errorText, msg, render, toLang, type Lang } from "./messages.js";
import { TikHubService } from "./service.js";
import type { CallOutcome } from "./service.js";
import { costKind } from "./cost.js";

/** Rome's global UI language, as stored by the dashboard (settings key "guardianLanguage"). */
export const GUARDIAN_LANGUAGE_KEY = "guardianLanguage";

export async function readGuardianLang(repos: Pick<AppRuntimeRepositories, "settings"> | undefined): Promise<Lang> {
  try {
    return toLang(await repos?.settings.get<string>(GUARDIAN_LANGUAGE_KEY));
  } catch {
    return "en";
  }
}

export async function serviceFromDeps(deps: AppActionRuntimeDeps): Promise<TikHubService> {
  const lang = await readGuardianLang(deps.appContext.repositories);
  return new TikHubService(deps.appContext.db, fetch, undefined, lang);
}

/** Run an action body with a language-bound service; thrown errors become `{ status: "error" }` in that language. */
export async function guarded<T>(deps: AppActionRuntimeDeps, fn: (svc: TikHubService) => Promise<T>): Promise<ActionResult> {
  return guardedResult(deps, async (svc) => ({ status: "ok", data: await fn(svc) }));
}

/** Same trusted boundary, for handlers that must map domain outcomes themselves. */
export async function guardedResult(deps: AppActionRuntimeDeps, fn: (svc: TikHubService) => Promise<ActionResult>): Promise<ActionResult> {
  // Current Core stamps actorKind on its trusted context. The pinned 0.6 SDK
  // predates that type field, but uses the same host-owned resolver symbol.
  // Old hosts without attribution fail closed; never infer identity from args.
  const context = getCurrentActionContext() as (CurrentActionContext & { actorKind?: string }) | undefined;
  if (context?.actorKind !== "guardian" || (context.channelContext !== undefined && context.channelContext.threadType !== "private") ||
      (context.channelContext?.senderBondLevel !== undefined && context.channelContext.senderBondLevel !== "guardian")) {
    const lang = await readGuardianLang(deps.appContext.repositories);
    return { status: "error", error: errorText(new AppError(msg("security.privateAction")), lang) };
  }
  let lang: Lang = "en";
  try {
    const svc = await serviceFromDeps(deps);
    lang = svc.lang;
    return await fn(svc);
  } catch (err) {
    const text = errorText(err, lang);
    return { status: "error", error: err instanceof AppError ? text : `TikHub: ${text}` };
  }
}

/** The SDK error envelope accepts a string, not a second data/status envelope. */
export function callActionResult(out: CallOutcome, lang: Lang): ActionResult {
  if (out.status !== "error" && out.status !== "blocked") return { status: "ok", data: { ...out, ok: true } };
  const kind = costKind(out);
  const cost = kind === "base_estimate"
    ? msg("cost.baseEstimate", { cost: `$${out.costUsd}` })
    : msg(kind === "not_billed" ? "cost.notBilled" : "cost.unknown");
  return { status: "error", error: render(msg("action.callFailed", {
    detail: out.error ?? msg("common.unknown"), callId: out.callId, attempts: out.attempts ?? 0, cost,
  }), lang) };
}
