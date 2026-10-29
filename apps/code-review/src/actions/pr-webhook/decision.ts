import type { TriggerAccessMode } from "../../lib/trigger-access.js";

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
  agentSettings?: import("../../lib/agent-settings.js").AgentSettings;
  autoReviewEnabled: boolean;
  triggerOnCreate: boolean;
  triggerOnRequest: boolean;
  triggerOnReviewRequest: boolean;
  triggerOnMention: boolean;
  triggerOnPush: boolean;
  triggerAccessMode?: TriggerAccessMode;
  triggerAllowlist?: string[];
  triggerBlocklist?: string[];
  mentionTriggerPhrase?: string;
  summaryTriggerPhrase?: string;
}

export interface TriggerAccessPolicy {
  mode?: TriggerAccessMode;
  allowlist?: string[];
  blocklist?: string[];
}

export type PRReviewTriggerType = "pr_opened" | "pr_synchronize" | "review_requested" | "mention";

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
      triggerType: PRReviewTriggerType;
      actorLogin: string | null;
      /** Text the requester wrote after the command phrase. */
      requestNote?: string;
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
      requestNote?: string;
    };

/** The command an `@bot <phrase>` comment resolves to. */
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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Characters that may separate a command phrase from its trailing note. */
const NOTE_SEPARATOR = "[\\s:,.;!?-]";

/**
 * Command parser. A comment is a command when it STARTS with `@<bot> <phrase>`
 * (case-insensitive, whitespace-flexible) and the phrase ends at a word
 * boundary. Any text after the phrase is returned as `note` — e.g.
 * `@bot PTAL focus on the migration` → review, note "focus on the migration".
 * When several phrases match, the longest wins; ties go to the earlier entry.
 *
 * Loop guard: the bot's own comments always begin with a heading or emoji
 * (reviews, summaries, `### Assistant` replies), never with `@<bot>`, so they
 * can never parse as a command.
 */
export function parseCommand<T extends string>(
  commentBody: string,
  botLogin: string | null,
  commands: ReadonlyArray<readonly [T, string]>,
): { id: T; note: string } | null {
  const bot = normalizeGitHubLogin(botLogin);
  if (!bot) return null;
  let best: { id: T; note: string; length: number } | null = null;
  for (const [id, phrase] of commands) {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const pattern = new RegExp(`^\\s*@${escapeRegExp(bot)}\\s+${words.map(escapeRegExp).join("\\s+")}(?=$|${NOTE_SEPARATOR})`, "i");
    const match = pattern.exec(commentBody);
    if (match && (!best || match[0].length > best.length)) {
      const note = commentBody.slice(match[0].length).replace(new RegExp(`^${NOTE_SEPARATOR}+`), "").trim();
      best = { id, note, length: match[0].length };
    }
  }
  return best && { id: best.id, note: best.note };
}

/** Text of a comment that starts with `@bot`, or null. `-` is not a boundary
 * here: `@bot-other` is a different GitHub user. */
export function mentionRequest(commentBody: string, botLogin: string | null): string | null {
  const bot = normalizeGitHubLogin(botLogin);
  if (!bot) return null;
  const match = new RegExp(`^\\s*@${escapeRegExp(bot)}(?=$|[\\s:,.;!?])`, "i").exec(commentBody);
  return match ? commentBody.slice(match[0].length).replace(new RegExp(`^${NOTE_SEPARATOR}+`), "").trim() : null;
}

/** Review/summary command for the legacy (pre-agent-settings) trigger path. */
export function parseStrictCommand(
  commentBody: string,
  botLogin: string,
  phrases: { reviewPhrase: string; summaryPhrase: string },
): { command: StrictCommand; note: string } | null {
  // Review is listed first so it wins if both phrases were configured identically.
  const parsed = parseCommand<StrictCommand>(commentBody, botLogin, [
    ["review", phrases.reviewPhrase.trim() || "PTAL"],
    ["summary", phrases.summaryPhrase.trim() || "summary"],
  ]);
  return parsed && { command: parsed.id, note: parsed.note };
}

export function triggerActor(payload: GitHubWebhookPayload, triggerType: PRReviewTriggerType): string | null {
  if (triggerType === "mention") {
    return normalizeGitHubLogin(payload.comment?.user?.login);
  }
  if (triggerType === "pr_opened") {
    return normalizeGitHubLogin(payload.pull_request?.user?.login);
  }
  // Synchronize and review-request events must identify the person who caused
  // this specific event. Falling back to the PR author would turn a missing
  // sender into a different, authorized identity in allow-all mode.
  return normalizeGitHubLogin(payload.sender?.login);
}

export function isTriggerActorAllowed(
  actorLogin: string | null,
  guardianLogin: string | null,
  policy: TriggerAccessPolicy,
): boolean {
  const actor = normalizeGitHubLogin(actorLogin);
  const guardian = normalizeGitHubLogin(guardianLogin);
  if (!actor || !guardian) return false;
  if (actor === guardian) return true;
  if (policy.mode === "blocklist") {
    return !(policy.blocklist || []).some((login) => normalizeGitHubLogin(login) === actor);
  }
  return (policy.allowlist || []).some((login) => normalizeGitHubLogin(login) === actor);
}

function triggerAccessPolicy(settings: PRReviewTriggerSettings): TriggerAccessPolicy {
  return {
    mode: settings.triggerAccessMode,
    allowlist: settings.triggerAllowlist,
    blocklist: settings.triggerBlocklist,
  };
}

function actorDeniedReason(
  actorRole: string,
  actorLogin: string | null,
  settings: PRReviewTriggerSettings,
): string {
  if (!normalizeGitHubLogin(actorLogin)) {
    const actorDescription = actorRole.startsWith("PR ") ? actorRole : actorRole.toLowerCase();
    return `Could not identify the ${actorDescription} for access filtering.`;
  }
  return settings.triggerAccessMode === "blocklist"
    ? `${actorRole} is in the review trigger blocklist.`
    : `${actorRole} is not in the review trigger allowlist.`;
}

/** Shared fail-closed access gate for addressed comment commands. */
export function commentTriggerAccess(payload: GitHubWebhookPayload, settings: PRReviewTriggerSettings, botLogin: string | null) {
  if (typeof payload.issue?.number !== "number") return { kind: "skip" as const, reason: "Issue comment has no issue/PR number." };
  if (!botLogin) return { kind: "skip" as const, reason: "Could not resolve GitHub bot login for mention filtering." };
  const actorLogin = triggerActor(payload, "mention");
  if (!isTriggerActorAllowed(actorLogin, botLogin, triggerAccessPolicy(settings))) {
    return { kind: "skip" as const, reason: actorDeniedReason("Mention trigger actor", actorLogin, settings) };
  }
  return { kind: "allowed" as const, actorLogin, number: payload.issue.number };
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
  /** Already-routed command (e.g. a catch-all comment); skips phrase parsing. */
  command?: { command: StrictCommand; note: string };
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

    // The comment must start with `@<bot> <phrase>`; trailing text is a note
    // for the agent. See parseCommand for the loop guard.
    const parsed = input.command ?? parseStrictCommand(payload.comment?.body || "", botLogin, {
      reviewPhrase: settings.mentionTriggerPhrase || "PTAL",
      summaryPhrase: settings.summaryTriggerPhrase || "summary",
    });
    if (!parsed) {
      return { kind: "skip", reason: "Comment does not start with an '@bot <command>' request." };
    }
    const { command, note } = parsed;

    const access = commentTriggerAccess(payload, settings, botLogin);
    if (access.kind === "skip") return access;
    const actorLogin = access.actorLogin;

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
        ...(note ? { requestNote: note } : {}),
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
      ...(note ? { requestNote: note } : {}),
    };
  }

  // Standalone `issues` events (opened/edited/...) are subscribed for coverage
  // but not auto-actioned — engage the bot with a command on a PR comment.
  if (event === "issues") {
    return { kind: "skip", reason: "Standalone issue events are not auto-actioned; comment a command on a PR to engage the bot." };
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
    if (!currentGitHubLogin) {
      return { kind: "skip", reason: "Could not resolve GitHub bot login for PR opener filtering." };
    }
    const actorLogin = triggerActor(payload, "pr_opened");
    if (!isTriggerActorAllowed(actorLogin, currentGitHubLogin, triggerAccessPolicy(settings))) {
      return { kind: "skip", reason: actorDeniedReason("PR opener", actorLogin, settings) };
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
    if (!currentGitHubLogin) {
      return { kind: "skip", reason: "Could not resolve GitHub bot login for PR pusher filtering." };
    }
    const actorLogin = triggerActor(payload, "pr_synchronize");
    if (!isTriggerActorAllowed(actorLogin, currentGitHubLogin, triggerAccessPolicy(settings))) {
      return { kind: "skip", reason: actorDeniedReason("PR pusher", actorLogin, settings) };
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
    const actorLogin = triggerActor(payload, "review_requested");
    if (!isTriggerActorAllowed(actorLogin, botLogin, triggerAccessPolicy(settings))) {
      return { kind: "skip", reason: actorDeniedReason("Review requester", actorLogin, settings) };
    }
    return { kind: "trigger", repo: repoSlug, prNumber: pr.number, action, pr, triggerType: "review_requested", actorLogin };
  }

  return { kind: "skip", reason: `Action '${action}' does not trigger a review.` };
}
