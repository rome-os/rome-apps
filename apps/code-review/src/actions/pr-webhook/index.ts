import { execFileSync } from "child_process";

import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createScanRepository } from "../../db/repositories/repo.js";
import {
  decidePRReviewTrigger,
  normalizeInput,
  repoFromPayload,
  triggerMayNeedCurrentGitHubLogin,
  type GitHubPullRequest,
} from "./decision.js";

const log = createAppLogger("code-review_pr-webhook");

function resolveGitHubLogin(): string | null {
  try {
    return execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim() || null;
  } catch (err) {
    log.info("Could not resolve GitHub login for request-trigger filtering", { error: String(err) });
    return null;
  }
}

async function queueReview(
  deps: AppActionRuntimeDeps,
  db: ReturnType<typeof createScanRepository>,
  args: {
    repo: string;
    prNumber: number;
    action: string;
    pr?: GitHubPullRequest;
    triggerCommentId?: number | null;
  },
): Promise<ActionResult> {
  const queuedReview = db.createQueuedPRReview({
    repo: args.repo,
    prNumber: args.prNumber,
    prUrl: args.pr?.html_url || null,
    prTitle: args.pr?.title || null,
    prAuthor: args.pr?.user?.login || null,
    headSha: args.pr?.head?.sha || null,
  });

  // Dispatch the review as an independent root execution, then wait only for
  // the runtime to accept it. The pr-review action uses commit-based locking to
  // prevent duplicate reviews.
  await deps.appContext.runAction(
    "code-review:code-review_pr-review",
    {
      repo: args.repo,
      prNumber: args.prNumber,
      reviewId: queuedReview.id,
      ...(args.triggerCommentId ? { triggerCommentId: args.triggerCommentId } : {}),
    },
    { detached: true },
  );

  return {
    status: "ok",
    data: {
      queued: true,
      reviewId: queuedReview.id,
      repo: args.repo,
      prNumber: args.prNumber,
      triggeredBy: `webhook:${args.action}`,
      ...(args.triggerCommentId ? { triggerCommentId: args.triggerCommentId } : {}),
    },
  };
}

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        githubEvent: { type: "string", description: "Routine event-bus GitHub event type" },
        __triggerPayload: { type: "object", description: "Raw GitHub webhook payload injected by RoutineEngine" },
      },
      required: ["githubEvent", "__triggerPayload"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const normalized = normalizeInput(input);
      if (!normalized) {
        return {
          status: "error",
          error: "Expected routine input { githubEvent, __triggerPayload }.",
        };
      }

      const { githubEvent: event, payload } = normalized;
      const action = typeof payload.action === "string" ? payload.action : "";
      const db = createScanRepository(deps.appContext.db);

      log.info("Received GitHub event", { event, action });

      // Backstop: fail any review left stuck in a non-terminal state past the
      // stale threshold (a detached run that died on a restart, or a wedged
      // claim). Running it here — right before we may claim a new review — clears
      // stale in-progress rows that would otherwise block a fresh review of the
      // same commit. Best-effort; never let it break event handling.
      try {
        const reaped = db.reapStaleActiveReviews();
        if (reaped > 0) log.info("Reaped stale in-progress PR reviews", { reaped });
      } catch (err) {
        log.warn("Stale-review reaper failed (continuing)", { error: String(err) });
      }

      const repoSlug = repoFromPayload(payload);
      const settings = repoSlug ? db.getPRReviewSettings(repoSlug) : undefined;
      const currentGitHubLogin = triggerMayNeedCurrentGitHubLogin({ githubEvent: event, payload, settings })
        ? resolveGitHubLogin()
        : null;
      const decision = decidePRReviewTrigger({
        githubEvent: event,
        payload,
        settings,
        currentGitHubLogin,
      });

      if (decision.kind === "error") {
        return { status: "error", error: decision.error };
      }

      if (decision.kind === "skip") {
        log.info("Skipping GitHub event", {
          event,
          action,
          repo: decision.repo ?? repoSlug,
          prNumber: decision.prNumber,
          reason: decision.reason,
        });
        return {
          status: "ok",
          data: {
            skipped: true,
            reason: decision.reason,
            ...(decision.repo ? { repo: decision.repo } : {}),
            ...(typeof decision.prNumber === "number" ? { prNumber: decision.prNumber } : {}),
          },
        };
      }

      // Exact `@bot <summaryPhrase>` command → recap the PR's reviews/discussion
      // via the dedicated pr-summary action (fire-and-forget). Parallel to review.
      if (decision.kind === "summary") {
        log.info("Delegating to pr-summary action (fire-and-forget)", {
          repo: decision.repo,
          prNumber: decision.prNumber,
          triggerCommentId: decision.triggerCommentId,
          actorLogin: decision.actorLogin,
        });
        await deps.appContext.runAction(
          "code-review:code-review_pr-summary",
          {
            repo: decision.repo,
            prNumber: decision.prNumber,
            triggerCommentId: decision.triggerCommentId,
            commentBody: decision.commentBody,
            actorLogin: decision.actorLogin,
          },
          { detached: true },
        );
        return {
          status: "ok",
          data: {
            summaryQueued: true,
            repo: decision.repo,
            prNumber: decision.prNumber,
            triggerCommentId: decision.triggerCommentId,
          },
        };
      }

      log.info("Delegating to pr-review action (fire-and-forget)", {
        repo: decision.repo,
        prNumber: decision.prNumber,
        triggeredBy: action,
        triggerType: decision.triggerType,
        actorLogin: decision.actorLogin,
        triggerCommentId: decision.triggerCommentId,
      });
      return await queueReview(deps, db, {
        repo: decision.repo,
        prNumber: decision.prNumber,
        action: decision.action,
        pr: decision.pr,
        triggerCommentId: decision.triggerCommentId,
      });
    },
  };
}
