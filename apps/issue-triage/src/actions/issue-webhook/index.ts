import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTriageRepository } from "../../db/repositories/repo.js";
import { contentSignature } from "../../utils/hash.js";

const log = createAppLogger("issue-triage:issue-webhook");

/** Actions we react to and the setting each maps to. */
const OPEN_ACTIONS = new Set(["opened"]);
const EDIT_ACTIONS = new Set(["edited", "reopened"]);

interface WebhookInput {
  githubEvent?: string;
  __triggerPayload?: Record<string, unknown>;
}

function readPayload(input: Record<string, unknown>): Record<string, any> | null {
  const raw = input.__triggerPayload;
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  // Some routine deliveries nest the body one level deeper.
  if (input && typeof input === "object" && "action" in input) return input as Record<string, any>;
  return null;
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        githubEvent: { type: "string", description: "Routine event-bus GitHub event type" },
        __triggerPayload: { type: "object", description: "Raw GitHub webhook payload injected by the routine engine" },
      },
      required: ["githubEvent", "__triggerPayload"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const typed = input as WebhookInput;
      const payload = readPayload(input);
      if (!payload) {
        return { status: "error", error: "Expected routine input { githubEvent, __triggerPayload }." };
      }

      const action = typeof payload.action === "string" ? payload.action : "";
      const issue = payload.issue as Record<string, any> | undefined;
      const repository = payload.repository as Record<string, any> | undefined;
      const repoSlug = repository?.full_name ? String(repository.full_name) : null;

      log.info("Received GitHub issues event", { action, repo: repoSlug, issueNumber: issue?.number });

      if (!issue || !repoSlug || typeof issue.number !== "number") {
        return { status: "ok", data: { skipped: true, reason: "missing_issue_or_repo" } };
      }

      // Ignore pull requests (they arrive on the `issues` payload with a
      // pull_request field only when it's actually an issue-comment surface, but
      // guard anyway).
      if (issue.pull_request) {
        return { status: "ok", data: { skipped: true, reason: "pull_request" } };
      }

      const db = createTriageRepository(deps.appContext.db);
      const settings = db.getRepoSettings(repoSlug);

      if (!settings || !settings.autoTriageEnabled) {
        return { status: "ok", data: { skipped: true, reason: "auto_triage_disabled", repo: repoSlug } };
      }

      const isOpen = OPEN_ACTIONS.has(action);
      const isEdit = EDIT_ACTIONS.has(action);
      if (!isOpen && !isEdit) {
        return { status: "ok", data: { skipped: true, reason: `unhandled_action:${action}` } };
      }
      if (isOpen && !settings.triggerOnOpen) {
        return { status: "ok", data: { skipped: true, reason: "trigger_on_open_disabled" } };
      }
      if (isEdit && !settings.triggerOnEdit) {
        return { status: "ok", data: { skipped: true, reason: "trigger_on_edit_disabled" } };
      }

      const issueNumber = issue.number as number;
      const title = String(issue.title ?? "");
      const body = String(issue.body ?? "");
      const signature = contentSignature(title, body);

      // Idempotency: skip if the same content was already triaged recently or a
      // triage is currently in flight for this issue.
      if (db.hasActiveResult(repoSlug, issueNumber)) {
        return { status: "ok", data: { skipped: true, reason: "triage_in_progress", repo: repoSlug, issueNumber } };
      }
      if (db.hasRecentResultForSignature(repoSlug, issueNumber, signature)) {
        return { status: "ok", data: { skipped: true, reason: "duplicate_content", repo: repoSlug, issueNumber } };
      }

      const actor = `webhook:${action}`;
      const queued = db.createQueuedResult({
        repo: repoSlug,
        issueNumber,
        issueTitle: title || null,
        issueUrl: typeof issue.html_url === "string" ? issue.html_url : null,
        actor,
        contentSig: signature,
      });

      await deps.appContext.runAction(
        "issue-triage:issue-triage_triage-issue",
        { repo: repoSlug, issueNumber, resultId: queued.id, actor },
        { detached: true },
      );

      log.info("Dispatched triage worker", { repo: repoSlug, issueNumber, resultId: queued.id, actor, event: typed.githubEvent });

      return {
        status: "ok",
        data: { queued: true, resultId: queued.id, repo: repoSlug, issueNumber, triggeredBy: actor },
      };
    },
  };
}
