export interface GitHubUser {
  login?: string;
}

export interface GitHubPullRequest {
  number: number;
  title?: string;
  html_url?: string;
  user?: GitHubUser;
  head?: { sha?: string };
  base?: { repo?: { full_name?: string } };
}

export interface GitHubIssue {
  number?: number;
  pull_request?: unknown;
}

export interface GitHubComment {
  id?: number;
  body?: string;
  user?: GitHubUser;
}

export interface GitHubWebhookPayload {
  action?: string;
  pull_request?: GitHubPullRequest;
  issue?: GitHubIssue;
  comment?: GitHubComment;
  repository?: {
    full_name?: string;
  };
  requested_reviewer?: GitHubUser;
  sender?: GitHubUser;
  [key: string]: unknown;
}

export interface RoutineWebhookInput {
  /** The GitHub webhook event type from the routine topic, e.g. "pull_request". */
  githubEvent: string;
  /** Raw GitHub webhook payload injected by RoutineEngine. */
  payload: GitHubWebhookPayload;
}

export interface PRReviewTriggerSettings {
  autoReviewEnabled: boolean;
  triggerOnCreate: boolean;
  triggerOnRequest: boolean;
  triggerOnReviewRequest: boolean;
  triggerOnMention: boolean;
  triggerOnPush: boolean;
  triggerAllowlist?: string[];
  mentionTriggerPhrase?: string;
  summaryTriggerPhrase?: string;
}

export type TriggerDecision =
  | {
      kind: "error";
      error: string;
    }
  | {
      kind: "skip";
      reason: string;
      repo?: string;
      prNumber?: number;
    }
  | {
      kind: "trigger";
      repo: string;
      prNumber: number;
      action: string;
      pr?: GitHubPullRequest;
      triggerCommentId?: number | null;
      triggerType: "pr_opened" | "pr_synchronize" | "review_requested" | "mention";
      actorLogin: string | null;
    }
  // Exact `@bot <summaryPhrase>` command on a PR comment: recap the PR's reviews
  // and discussion. Routed to the dedicated pr-summary action, parallel to (and
  // independent of) pr-review.
  | {
      kind: "summary";
      repo: string;
      prNumber: number;
      triggerCommentId: number | null;
      commentBody: string;
      actorLogin: string | null;
    };

/** The command an exact `@bot <phrase>` comment resolves to. */
export type StrictCommand = "review" | "summary";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asWebhookPayload(value: unknown): GitHubWebhookPayload | null {
  return isRecord(value) ? (value as GitHubWebhookPayload) : null;
}

export function normalizeInput(input: Record<string, unknown>): RoutineWebhookInput | null {
  const triggerPayload = asWebhookPayload(input.__triggerPayload);
  if (typeof input.githubEvent === "string" && triggerPayload) {
    return {
      githubEvent: input.githubEvent,
      payload: triggerPayload,
    };
  }

  return null;
}

export function repoFromPayload(payload: GitHubWebhookPayload): string {
  return payload.repository?.full_name || payload.pull_request?.base?.repo?.full_name || "";
}

export function normalizeGitHubLogin(login: unknown): string | null {
  if (typeof login !== "string") return null;
  const normalized = login.trim().replace(/^@+/, "").toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Collapse every run of whitespace to a single space, trim the ends, and
 * lowercase. Lets an exact-command comparison tolerate surrounding and internal
 * whitespace while rejecting any other content.
 */
function normalizeCommentBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Strict command parser. The comment body must be EXACTLY an addressed command —
 * `@<bot> <phrase>` — with only leading / trailing / internal whitespace allowed
 * and NOTHING else (no extra words, punctuation, or quoted text). Matching is
 * case-insensitive and whitespace-flexible.
 *
 * This exactness IS the loop guard: the bot's own comments are always rich text
 * (summaries, replies, reviews), so they can never equal a bare command and thus
 * can never re-trigger the webhook. No provenance check is needed — any comment
 * carrying content beyond the command is simply ignored.
 */
export function parseStrictCommand(
  commentBody: string,
  botLogin: string,
  phrases: { reviewPhrase: string; summaryPhrase: string },
): StrictCommand | null {
  const bot = normalizeGitHubLogin(botLogin);
  if (!bot) return null;
  const normalized = normalizeCommentBody(commentBody);
  const target = (phrase: string) => normalizeCommentBody(`@${bot} ${phrase}`);

  const reviewPhrase = phrases.reviewPhrase.trim() || "PTAL";
  const summaryPhrase = phrases.summaryPhrase.trim() || "summary";

  // Review is checked first so it wins if both phrases were configured identically.
  if (normalized === target(reviewPhrase)) return "review";
  if (normalized === target(summaryPhrase)) return "summary";
  return null;
}

export function triggerActor(payload: GitHubWebhookPayload): string | null {
  return normalizeGitHubLogin(payload.comment?.user?.login || payload.sender?.login || payload.pull_request?.user?.login);
}

export function isTriggerActorAllowed(
  actorLogin: string | null,
  guardianLogin: string | null,
  allowlist: string[] | undefined,
): boolean {
  const actor = normalizeGitHubLogin(actorLogin);
  const guardian = normalizeGitHubLogin(guardianLogin);
  if (!actor || !guardian) return false;
  if (actor === guardian) return true;
  return (allowlist || []).some((login) => normalizeGitHubLogin(login) === actor);
}

function prNumberFromPayload(payload: GitHubWebhookPayload): { prNumber?: number } {
  if (typeof payload.pull_request?.number === "number") return { prNumber: payload.pull_request.number };
  if (typeof payload.issue?.number === "number") return { prNumber: payload.issue.number };
  return {};
}


export function triggerMayNeedCurrentGitHubLogin(input: {
  githubEvent: string;
  payload: GitHubWebhookPayload;
  settings: PRReviewTriggerSettings | undefined;
}): boolean {
  const { githubEvent: event, payload, settings } = input;
  const action = typeof payload.action === "string" ? payload.action : "";
  const repoSlug = repoFromPayload(payload);
  if (!repoSlug || (!settings?.autoReviewEnabled && !settings?.triggerOnRequest)) return false;

  if (event === "issue_comment") {
    // Command detection needs the bot login to build the `@<bot> <phrase>` target.
    return action === "created"
      && !!settings.triggerOnRequest
      && !!settings.triggerOnMention
      && typeof payload.issue?.number === "number";
  }

  if (event !== "pull_request" || !payload.pull_request) return false;
  if (action === "opened") return !!settings.autoReviewEnabled && !!settings.triggerOnCreate;
  if (action === "synchronize") return !!settings.autoReviewEnabled && !!settings.triggerOnPush;
  if (action === "review_requested") return !!settings.triggerOnRequest && !!settings.triggerOnReviewRequest;
  return false;
}

export function decidePRReviewTrigger(input: {
  githubEvent: string;
  payload: GitHubWebhookPayload;
  settings: PRReviewTriggerSettings | undefined;
  currentGitHubLogin: string | null;
}): TriggerDecision {
  const { githubEvent: event, payload, settings, currentGitHubLogin } = input;
  const action = typeof payload.action === "string" ? payload.action : "";
  const repoSlug = repoFromPayload(payload);

  if (!repoSlug) {
    return { kind: "error", error: "Could not determine repository from webhook payload." };
  }

  if (!settings?.autoReviewEnabled && !settings?.triggerOnRequest) {
    return {
      kind: "skip",
      reason: `No webhook-driven PR review trigger is enabled for ${repoSlug}.`,
      repo: repoSlug,
      ...prNumberFromPayload(payload),
    };
  }

  if (event === "issue_comment") {
    if (action !== "created") {
      return { kind: "skip", reason: `Action '${action}' does not trigger a review.` };
    }
    if (!settings.triggerOnRequest) {
      return { kind: "skip", reason: `Trigger on request is disabled for ${repoSlug}.` };
    }
    if (!settings.triggerOnMention) {
      return { kind: "skip", reason: `Mention manual trigger is disabled for ${repoSlug}.` };
    }
    const issue = payload.issue;
    if (typeof issue?.number !== "number") {
      return { kind: "skip", reason: "Issue comment has no issue/PR number." };
    }

    const botLogin = currentGitHubLogin;
    if (!botLogin) {
      return { kind: "skip", reason: "Could not resolve GitHub bot login for mention filtering." };
    }

    // Strict command model: the body must be EXACTLY `@<bot> <phrase>` (only
    // whitespace tolerated). Anything with extra content — a sentence, a quoted
    // block, or the bot's own summary/review output — fails the match and is
    // ignored. This is the loop guard: the bot can never emit a bare command, so
    // its own comments can never re-trigger the webhook.
    const command = parseStrictCommand(payload.comment?.body || "", botLogin, {
      reviewPhrase: settings.mentionTriggerPhrase || "PTAL",
      summaryPhrase: settings.summaryTriggerPhrase || "summary",
    });
    if (!command) {
      return { kind: "skip", reason: "Comment is not an exact '@bot <command>' request." };
    }

    const actorLogin = triggerActor(payload);
    if (!isTriggerActorAllowed(actorLogin, botLogin, settings.triggerAllowlist)) {
      return { kind: "skip", reason: "Mention trigger actor is not in the review trigger allowlist." };
    }

    // Both commands operate on a PR's diff / reviews. A comment on a real issue
    // (no linked pull request) has nothing to review or summarize.
    if (!issue.pull_request) {
      return { kind: "skip", reason: `The '${command}' command is only supported on pull requests.` };
    }

    if (command === "review") {
      return {
        kind: "trigger",
        repo: repoSlug,
        prNumber: issue.number,
        action,
        triggerCommentId: payload.comment?.id ?? null,
        triggerType: "mention",
        actorLogin,
      };
    }

    // command === "summary"
    return {
      kind: "summary",
      repo: repoSlug,
      prNumber: issue.number,
      triggerCommentId: payload.comment?.id ?? null,
      commentBody: payload.comment?.body || "",
      actorLogin,
    };
  }

  // Standalone `issues` events (opened/edited/...) are subscribed for coverage
  // but not auto-actioned — engage the bot with an exact command on a PR comment.
  if (event === "issues") {
    return { kind: "skip", reason: "Standalone issue events are not auto-actioned; comment an exact command on a PR to engage the bot." };
  }

  if (event !== "pull_request") {
    return { kind: "skip", reason: `Event '${event}' is not a pull_request or issue_comment event.` };
  }

  const pr = payload.pull_request;
  if (!pr) {
    return { kind: "error", error: "Missing pull_request in webhook payload." };
  }

  if (action === "opened") {
    if (!settings.autoReviewEnabled) {
      return { kind: "skip", reason: `Auto trigger is disabled for ${repoSlug}.` };
    }
    if (!settings.triggerOnCreate) {
      return { kind: "skip", reason: `Trigger on create is disabled for ${repoSlug}.` };
    }
    const actorLogin = triggerActor(payload);
    if (!currentGitHubLogin || !isTriggerActorAllowed(actorLogin, currentGitHubLogin, settings.triggerAllowlist)) {
      return { kind: "skip", reason: "PR opener is not in the review trigger allowlist." };
    }
    return { kind: "trigger", repo: repoSlug, prNumber: pr.number, action, pr, triggerType: "pr_opened", actorLogin };
  }

  if (action === "synchronize") {
    if (!settings.autoReviewEnabled) {
      return { kind: "skip", reason: `Auto trigger is disabled for ${repoSlug}.` };
    }
    if (!settings.triggerOnPush) {
      return { kind: "skip", reason: `Trigger on push is disabled for ${repoSlug}.` };
    }
    const actorLogin = triggerActor(payload);
    if (!currentGitHubLogin || !isTriggerActorAllowed(actorLogin, currentGitHubLogin, settings.triggerAllowlist)) {
      return { kind: "skip", reason: "PR pusher is not in the review trigger allowlist." };
    }
    return { kind: "trigger", repo: repoSlug, prNumber: pr.number, action, pr, triggerType: "pr_synchronize", actorLogin };
  }

  if (action === "review_requested") {
    if (!settings.triggerOnRequest) {
      return { kind: "skip", reason: `Trigger on request is disabled for ${repoSlug}.` };
    }
    if (!settings.triggerOnReviewRequest) {
      return { kind: "skip", reason: `GitHub review request manual trigger is disabled for ${repoSlug}.` };
    }
    const botLogin = currentGitHubLogin;
    if (!botLogin) {
      return { kind: "skip", reason: "Could not resolve GitHub bot login for review_requested filtering." };
    }
    const requestedLogin = payload.requested_reviewer?.login || "";
    if (requestedLogin.toLowerCase() !== botLogin.toLowerCase()) {
      return { kind: "skip", reason: `Review was requested from ${requestedLogin || "another reviewer"}, not ${botLogin}.` };
    }
    const actorLogin = triggerActor(payload);
    if (!isTriggerActorAllowed(actorLogin, botLogin, settings.triggerAllowlist)) {
      return { kind: "skip", reason: "Review requester is not in the review trigger allowlist." };
    }
    return { kind: "trigger", repo: repoSlug, prNumber: pr.number, action, pr, triggerType: "review_requested", actorLogin };
  }

  return { kind: "skip", reason: `Action '${action}' does not trigger a review.` };
}
