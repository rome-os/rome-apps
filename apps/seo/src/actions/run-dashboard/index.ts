import type {
  Action,
  ActionConfig,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createRunsRepository } from "../../db/repositories/runs.js";
import { checkPage } from "../../lib/safe-fetch.js";
import { SEO_WORKFLOWS } from "../../lib/workflows.js";

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async execute(input) {
      const repo = createRunsRepository(deps.appContext.db);
      const run = repo.get(String(input.id));
      if (!run || run.status !== "pending")
        return { status: "error", error: "Pending dashboard run not found" };
      // Synchronous compare-and-set before the first await prevents duplicate dispatch.
      repo.update(run.id, { status: "running" });
      try {
        if (run.kind === "check") {
          const result = await checkPage(run.input.url);
          repo.update(run.id, {
            status: "completed",
            result,
            completedAt: Date.now(),
          });
        } else {
          if (!run.workflow || !Object.hasOwn(SEO_WORKFLOWS, run.workflow))
            throw new Error("Unknown workflow");
          const result = await deps.appContext.runAction(
            `seo:${run.workflow}`,
            run.input,
          );
          if (result.status !== "ok")
            throw new Error(
              result.status === "error"
                ? result.error
                : "SEO agent did not complete",
            );
          const data = result.data as
            | { result?: unknown; sessionId?: string }
            | undefined;
          const report = typeof data?.result === "string" ? data.result : "";
          if (!report.trim())
            throw new Error(
              "The SEO agent returned an empty report. Please re-run.",
            );
          repo.update(run.id, {
            status: "completed",
            report,
            sessionId: data?.sessionId || null,
            completedAt: Date.now(),
          });
        }
        return { status: "ok", data: { id: run.id } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repo.update(run.id, {
          status: "failed",
          error: message,
          completedAt: Date.now(),
        });
        return { status: "error", error: message };
      }
    },
  };
}
