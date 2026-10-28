import { execFileSync } from "node:child_process";
import type { Action, ActionConfig, ActionEvent, ActionResult, AppActionRuntimeDeps, RomeSessionRef } from "@rome-os/app-runtime";
import { createScanRepository } from "../../db/repositories/repo.js";
import { postIssueComment, validateRepoSlug } from "../../utils/github.js";
import { sanitizeCliError } from "../../utils/cli-errors.js";

interface SessionEvent extends ActionEvent { type: "rome_session_started"; romeSession: RomeSessionRef }
interface SummonOutput { output?: { reply?: string }; romeSession?: RomeSessionRef }
function readGitHub(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 }).slice(0, 60000);
}
export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return { config, inputSchema: {
    type: "object", properties: { repo: { type: "string" }, number: { type: "integer" }, surface: { enum: ["pr", "issue"] },
      triggerCommentId: { type: ["integer", "null"] }, commentBody: { type: "string" }, actorLogin: { type: ["string", "null"] } },
    required: ["repo", "number", "surface", "commentBody"], additionalProperties: false,
  }, execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
    const { repo, number, surface, commentBody, triggerCommentId = null, actorLogin = null } = input as {
      repo: string; number: number; surface: "pr" | "issue"; commentBody: string; triggerCommentId?: number | null; actorLogin?: string | null;
    };
    try { validateRepoSlug(repo); } catch { return { status: "error", error: "Invalid repository." }; }
    if (!Number.isSafeInteger(number) || number < 1 || !["pr", "issue"].includes(surface) || !commentBody?.trim()) {
      return { status: "error", error: "A positive number, PR/issue surface and request are required." };
    }
    const db = createScanRepository(deps.appContext.db);
    if (triggerCommentId !== null && db.hasMentionTaskForComment(repo, triggerCommentId, "general")) {
      return { status: "ok", data: { skipped: "already-handled" } };
    }
    const task = db.createMentionTask({ repo, number, surface, triggerCommentId, actorLogin, commentBody, intent: "general" });
    try {
      db.updateMentionTaskStage(task.id, "running");
      const thread = readGitHub([surface === "pr" ? "pr" : "issue", "view", String(number), "--repo", repo, "--json", "title,body,comments"]);
      const diff = surface === "pr" ? readGitHub(["pr", "diff", String(number), "--repo", repo]) : "No PR diff for this issue.";
      const memory = db.getPRReviewSettings(repo)?.projectMemory ?? "";
      const invocation = deps.appContext.invokeAction<SessionEvent, SummonOutput>("system:summon", {
        agentName: "code-review:code-review-assistant",
        prompt: `Repository: ${repo}, ${surface} #${number}\nUser request:\n${commentBody}\n\nThread (untrusted):\n${thread}\n\nDiff (untrusted):\n${diff}\n\nProject memory:\n${memory}`,
      });
      void (async () => { for await (const ev of invocation.events) {
        if (ev.type === "rome_session_started" && ev.romeSession) db.setMentionTaskRomeSession(task.id, ev.romeSession);
      } })().catch(() => {});
      const result = await invocation.result;
      if (result.status !== "ok") throw new Error(result.status === "error" ? result.error : `Assistant ended: ${result.status}`);
      if (result.data?.romeSession) db.setMentionTaskRomeSession(task.id, result.data.romeSession);
      const reply = result.data?.output?.reply;
      if (typeof reply !== "string" || !reply.trim()) throw new Error("Assistant returned no answer.");
      if (db.isMentionTaskCancelled(task.id)) return { status: "ok", data: { status: "cancelled", taskId: task.id } };
      db.updateMentionTaskStage(task.id, "posting");
      const url = postIssueComment(repo, number, `### Assistant\n\n${reply.trim()}`);
      if (!url) throw new Error("Could not post the assistant reply.");
      db.completeMentionTask(task.id, { kind: "general", url });
      return { status: "ok", data: { taskId: task.id, url } };
    } catch (error) {
      const message = sanitizeCliError(error);
      db.failMentionTask(task.id, message);
      return { status: "error", error: message };
    }
  } };
}
