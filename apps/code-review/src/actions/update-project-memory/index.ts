import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createScanRepository } from "../../db/repositories/repo.js";
import { addCommentReaction, postIssueComment, validateRepoSlug } from "../../utils/github.js";

const log = createAppLogger("code-review_update_project_memory");

interface Input {
  /** Chassis-minted task token (agent path). The repo/target is resolved from it. */
  taskToken?: string;
  /** Repo slug for the manual dashboard path (no taskToken). */
  repo?: string;
  /** The FULL new project-memory text (not a diff). Empty/null clears it. */
  content?: string | null;
  /** One-line, plain-words summary of what changed. */
  summary?: string | null;
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        taskToken: { type: "string", description: "Chassis task token; repo/target resolved from it (agent path)." },
        repo: { type: "string", description: "Repo slug (owner/repo) for the manual dashboard path." },
        content: { type: ["string", "null"], description: "Full new project-memory text (not a diff)." },
        summary: { type: ["string", "null"], description: "One-line summary of what changed." },
      },
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const { taskToken, repo, content, summary } = input as Input;
      const db = createScanRepository(deps.appContext.db);
      const finalContent = typeof content === "string" ? content : content == null ? null : String(content);
      const finalSummary = typeof summary === "string" && summary.trim() ? summary.trim() : null;

      // --- Agent path: resolve target from the task token (cannot be spoofed) ---
      if (taskToken) {
        const task = db.getMentionTask(taskToken);
        if (!task) return { status: "error", error: `Unknown taskToken: ${taskToken}` };
        if (db.isMentionTaskCancelled(task.id)) {
          return { status: "ok", data: { noop: "cancelled", taskId: task.id } };
        }
        if (task.status === "completed") {
          return { status: "ok", data: { noop: "idempotent", taskId: task.id } };
        }

        const source = task.surface === "pr" ? "pr_feedback" : "issue_feedback";
        const sourceRef = task.triggerCommentId != null ? String(task.triggerCommentId) : String(task.number);
        const res = db.writeProjectMemory({
          repo: task.repo,
          after: finalContent,
          source,
          sourceRef,
          actor: "agent",
          taskId: task.id,
          summary: finalSummary,
        });

        // Reply on the GitHub thread and finalize the task (the commit point).
        const note = finalSummary
          ? `🧠 **Project memory updated.** ${finalSummary}`
          : `🧠 **Project memory updated.**`;
        let url: string | null = null;
        try {
          url = postIssueComment(task.repo, task.number, note);
        } catch (err) {
          log.warn("Failed to post memory-update reply", { taskId: task.id, error: String(err) });
        }
        if (task.triggerCommentId != null) {
          try { addCommentReaction(task.repo, task.triggerCommentId, "rocket"); } catch { /* best-effort */ }
        }
        const memoryBody = res.after
          ? `${note}\n\n**Updated project memory:**\n\n${res.after}`
          : note;
        db.completeMentionTask(task.id, { kind: "update-memory", url, editId: res.edit.id, body: memoryBody });

        log.info("Project memory updated via agent", { taskId: task.id, repo: task.repo, editId: res.edit.id });
        return { status: "ok", data: { updated: true, taskId: task.id, before: res.before, after: res.after, url } };
      }

      // --- Manual dashboard path ---
      if (repo) {
        validateRepoSlug(repo);
        const res = db.writeProjectMemory({
          repo,
          after: finalContent,
          source: "manual_ui",
          sourceRef: "dashboard",
          actor: "user",
          taskId: null,
          summary: finalSummary,
        });
        log.info("Project memory updated via dashboard", { repo, editId: res.edit.id });
        return { status: "ok", data: { updated: true, repo, before: res.before, after: res.after, editId: res.edit.id } };
      }

      return { status: "error", error: "Either taskToken (agent path) or repo (dashboard path) is required." };
    },
  };
}
