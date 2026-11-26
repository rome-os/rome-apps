import type { AppStartedHook, AppStartedHookDeps } from "@rome-os/app-runtime";
import { createRepository } from "../../db/repositories/lark.js";
export function createHook(deps: AppStartedHookDeps): AppStartedHook {
  return {
    onAppStarted() {
      createRepository(deps.appContext.db).recoverInterrupted();
    },
  };
}
