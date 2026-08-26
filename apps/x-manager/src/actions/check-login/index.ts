import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { runTwitterCli, parseYamlRecords } from "../../lib/cli.js";
import { createXRepository } from "../../db/repositories/repo.js";

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(): Promise<ActionResult> {
      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "check-login",
          status: "running",
          startedAt: new Date(),
        });
      } catch { /* DB not yet available */ }

      const result = await runTwitterCli("profile", []);

      if (!result.success) {
        const errLower = (result.stderr + result.stdout).toLowerCase();
        if (
          errLower.includes("login") ||
          errLower.includes("sign in") ||
          errLower.includes("not authenticated") ||
          errLower.includes("redirect") ||
          errLower.includes("unauthorized")
        ) {
          try {
            repo?.upsertAccountState({ handle: "unknown", loginStatus: "not_logged_in" });
            repo?.completeActionRun(runId, "success", JSON.stringify({ loggedIn: false }));
          } catch { /* best effort */ }

          return {
            status: "ok",
            data: {
              loggedIn: false,
              message:
                "You are not logged in to X. Please go to the [desktop browser](/desktop) and log in to https://x.com first, then try again.",
            },
          };
        }

        try {
          repo?.completeActionRun(runId, "error", null, result.stderr || result.stdout);
        } catch { /* best effort */ }

        return {
          status: "error",
          error: `Failed to check X login status: ${result.stderr || result.stdout}`,
        };
      }

      const records = parseYamlRecords(result.stdout);
      const profile = records[0];

      if (!profile || !profile["screen_name"]) {
        try {
          repo?.upsertAccountState({ handle: "unknown", loginStatus: "unknown" });
          repo?.completeActionRun(runId, "success", JSON.stringify({ loggedIn: false }));
        } catch { /* best effort */ }

        return {
          status: "ok",
          data: {
            loggedIn: false,
            message:
              "Could not determine X login status. Please go to the [desktop browser](/desktop) and log in to https://x.com first.",
          },
        };
      }

      const data = {
        loggedIn: true,
        username: profile["screen_name"],
        name: profile["name"] || "",
        followers: profile["followers"] || "0",
        following: profile["following"] || "0",
        tweets: profile["tweets"] || "0",
        bio: profile["bio"] || "",
        message: `Logged in as @${profile["screen_name"]}`,
      };

      try {
        repo?.upsertAccountState({
          handle: profile["screen_name"]!,
          displayName: profile["name"] || null,
          bio: profile["bio"] || null,
          followers: profile["followers"] || null,
          following: profile["following"] || null,
          tweets: profile["tweets"] || null,
          loginStatus: "logged_in",
        });
        repo?.completeActionRun(runId, "success", JSON.stringify(data));
      } catch { /* best effort */ }

      return { status: "ok", data };
    },
  };
}
