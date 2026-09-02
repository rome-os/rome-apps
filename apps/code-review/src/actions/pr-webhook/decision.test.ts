import { describe, expect, it } from "vitest";
import {
  decidePRReviewTrigger,
  parseStrictCommand,
  isTriggerActorAllowed,
  normalizeInput,
  triggerMayNeedCurrentGitHubLogin,
  type GitHubWebhookPayload,
  type PRReviewTriggerSettings,
} from "./decision.js";

const repo = "amantru/rome-apps";
const login = "rome-bot";

function settings(overrides: Partial<PRReviewTriggerSettings> = {}): PRReviewTriggerSettings {
  return {
    autoReviewEnabled: true,
    triggerOnCreate: true,
    triggerOnRequest: true,
    triggerOnReviewRequest: true,
    triggerOnMention: true,
    triggerOnPush: true,
    triggerAccessMode: "allowlist",
    triggerAllowlist: [],
    triggerBlocklist: [],
    mentionTriggerPhrase: "PTAL",
    ...overrides,
  };
}

function decide(
  githubEvent: string,
  payload: GitHubWebhookPayload,
  overrides: Partial<PRReviewTriggerSettings> = {},
  currentGitHubLogin: string | null = login,
) {
  return decidePRReviewTrigger({
    githubEvent,
    payload,
    settings: settings(overrides),
    currentGitHubLogin,
  });
}

function prPayload(action: string, actor = login): GitHubWebhookPayload {
  return {
    action,
    repository: { full_name: repo },
    sender: { login: actor },
    pull_request: {
      number: 42,
      html_url: `https://github.com/${repo}/pull/42`,
      title: "Improve trigger gates",
      user: { login: actor },
      head: { sha: "abc123" },
    },
  };
}

function commentPayload(body: string, actor = login): GitHubWebhookPayload {
  return {
    action: "created",
    repository: { full_name: repo },
    issue: { number: 43, pull_request: { url: `https://api.github.com/repos/${repo}/pulls/43` } },
    comment: { id: 123, body, user: { login: actor } },
  };
}

describe("pr-webhook decision", () => {
  it("normalizes routine event-bus input", () => {
    expect(normalizeInput({ githubEvent: "pull_request", __triggerPayload: prPayload("opened") })).toMatchObject({
      githubEvent: "pull_request",
      payload: { action: "opened" },
    });
    expect(normalizeInput({ githubEvent: "pull_request" })).toBeNull();
  });

  it("skips when no webhook-driven trigger is enabled for the repo", () => {
    const result = decidePRReviewTrigger({
      githubEvent: "pull_request",
      payload: prPayload("opened"),
      settings: settings({ autoReviewEnabled: false, triggerOnRequest: false }),
      currentGitHubLogin: login,
    });

    expect(result).toEqual({
      kind: "skip",
      reason: `No webhook-driven PR review trigger is enabled for ${repo}.`,
      repo,
      prNumber: 42,
    });
  });

  it("accepts PR opened only through auto + create + ACL gates", () => {
    expect(decide("pull_request", prPayload("opened"))).toMatchObject({
      kind: "trigger",
      triggerType: "pr_opened",
      repo,
      prNumber: 42,
      actorLogin: login,
    });

    expect(decide("pull_request", prPayload("opened"), { autoReviewEnabled: false })).toMatchObject({
      kind: "skip",
      reason: `Auto trigger is disabled for ${repo}.`,
    });
    expect(decide("pull_request", prPayload("opened"), { triggerOnCreate: false })).toMatchObject({
      kind: "skip",
      reason: `Trigger on create is disabled for ${repo}.`,
    });
    expect(decide("pull_request", prPayload("opened", "random-user"), { triggerAllowlist: ["trusted-user"] })).toMatchObject({
      kind: "skip",
      reason: "PR opener is not in the review trigger allowlist.",
    });
    expect(decide("pull_request", prPayload("opened", "trusted-user"), { triggerAllowlist: ["trusted-user"] })).toMatchObject({
      kind: "trigger",
      actorLogin: "trusted-user",
    });
  });

  it("accepts PR synchronize only through auto + push + ACL gates", () => {
    expect(decide("pull_request", prPayload("synchronize"))).toMatchObject({
      kind: "trigger",
      triggerType: "pr_synchronize",
      prNumber: 42,
    });

    expect(decide("pull_request", prPayload("synchronize"), { triggerOnPush: false })).toMatchObject({
      kind: "skip",
      reason: `Trigger on push is disabled for ${repo}.`,
    });
    expect(decide("pull_request", prPayload("synchronize", "random-user"), { triggerAllowlist: [] })).toMatchObject({
      kind: "skip",
      reason: "PR pusher is not in the review trigger allowlist.",
    });
  });

  it("accepts review_requested only when request is for current gh login and actor passes ACL", () => {
    const payload = {
      ...prPayload("review_requested", "trusted-user"),
      requested_reviewer: { login },
    };

    expect(decide("pull_request", payload, { autoReviewEnabled: false, triggerAllowlist: ["trusted-user"] })).toMatchObject({
      kind: "trigger",
      triggerType: "review_requested",
      actorLogin: "trusted-user",
    });
    expect(decide("pull_request", payload, { triggerOnRequest: false })).toMatchObject({
      kind: "skip",
      reason: `Trigger on request is disabled for ${repo}.`,
    });
    expect(decide("pull_request", payload, { triggerOnReviewRequest: false })).toMatchObject({
      kind: "skip",
      reason: `GitHub review request manual trigger is disabled for ${repo}.`,
    });
    expect(decide("pull_request", { ...payload, requested_reviewer: { login: "someone-else" } })).toMatchObject({
      kind: "skip",
      reason: `Review was requested from someone-else, not ${login}.`,
    });
    expect(decide("pull_request", { ...payload, sender: { login: "random-user" } }, { triggerAllowlist: [] })).toMatchObject({
      kind: "skip",
      reason: "Review requester is not in the review trigger allowlist.",
    });
    expect(decide("pull_request", payload, {}, null)).toMatchObject({
      kind: "skip",
      reason: "Could not resolve GitHub bot login for review_requested filtering.",
    });
  });

  it("triggers a review on an exact `@bot <mentionPhrase>` PR comment", () => {
    expect(decide("issue_comment", commentPayload("@rome-bot PTAL"), { autoReviewEnabled: false })).toMatchObject({
      kind: "trigger",
      triggerType: "mention",
      repo,
      prNumber: 43,
      triggerCommentId: 123,
    });
    // Whitespace (incl. CRLF and internal runs) is tolerated; case-insensitive.
    expect(decide("issue_comment", commentPayload("  @Rome-Bot   ptal \r\n"))).toMatchObject({
      kind: "trigger",
      triggerType: "mention",
    });
    // Custom, multi-word mention phrase is honored.
    expect(decide("issue_comment", commentPayload("@rome-bot please review", "trusted-user"), {
      triggerAllowlist: ["trusted-user"],
      mentionTriggerPhrase: "please review",
    })).toMatchObject({
      kind: "trigger",
      actorLogin: "trusted-user",
    });
  });

  it("gates issue_comment behind action + request + mention flags", () => {
    expect(decide("issue_comment", { ...commentPayload("@rome-bot PTAL"), action: "edited" })).toMatchObject({
      kind: "skip",
      reason: "Action 'edited' does not trigger a review.",
    });
    expect(decide("issue_comment", commentPayload("@rome-bot PTAL"), { triggerOnRequest: false })).toMatchObject({
      kind: "skip",
      reason: `Trigger on request is disabled for ${repo}.`,
    });
    expect(decide("issue_comment", commentPayload("@rome-bot PTAL"), { triggerOnMention: false })).toMatchObject({
      kind: "skip",
      reason: `Mention manual trigger is disabled for ${repo}.`,
    });
    expect(decide("issue_comment", commentPayload("@rome-bot PTAL", "random-user"), { triggerAllowlist: [] })).toMatchObject({
      kind: "skip",
      reason: "Mention trigger actor is not in the review trigger allowlist.",
    });
  });

  it("routes an exact `@bot <summaryPhrase>` PR comment to pr-summary", () => {
    expect(decide("issue_comment", commentPayload("@rome-bot summary"))).toMatchObject({
      kind: "summary",
      repo,
      prNumber: 43,
      triggerCommentId: 123,
      actorLogin: login,
    });
    // Custom summary phrase is honored.
    expect(decide("issue_comment", commentPayload("@rome-bot recap", "trusted-user"), {
      triggerAllowlist: ["trusted-user"],
      summaryTriggerPhrase: "recap",
    })).toMatchObject({
      kind: "summary",
      prNumber: 43,
    });
  });

  it("ignores anything that is not an EXACT command — this is the loop guard", () => {
    // Extra content beyond the command → skipped (the core anti-storm rule).
    expect(decide("issue_comment", commentPayload("@rome-bot summary please"))).toMatchObject({
      kind: "skip",
      reason: "Comment is not an exact '@bot <command>' request.",
    });
    expect(decide("issue_comment", commentPayload("@rome-bot can you fix the failing CI?"))).toMatchObject({
      kind: "skip",
      reason: "Comment is not an exact '@bot <command>' request.",
    });
    // The bot's own rich summary output can never equal a bare command → no loop.
    expect(decide("issue_comment", commentPayload(
      "## 📋 Discussion Summary\n\nReviews split: @rome-bot approved. summary follows.",
    ))).toMatchObject({
      kind: "skip",
      reason: "Comment is not an exact '@bot <command>' request.",
    });
    // A passing / cc mention with no command → skipped.
    expect(decide("issue_comment", commentPayload("thanks, cc @rome-bot"))).toMatchObject({
      kind: "skip",
      reason: "Comment is not an exact '@bot <command>' request.",
    });
    // A comment that never names the bot → skipped.
    expect(decide("issue_comment", commentPayload("Looks good"))).toMatchObject({
      kind: "skip",
      reason: "Comment is not an exact '@bot <command>' request.",
    });
  });

  it("restricts exact commands to PR comments (real issues have no diff)", () => {
    expect(decide("issue_comment", { ...commentPayload("@rome-bot PTAL"), issue: { number: 43 } })).toMatchObject({
      kind: "skip",
      reason: "The 'review' command is only supported on pull requests.",
    });
    expect(decide("issue_comment", { ...commentPayload("@rome-bot summary"), issue: { number: 43 } })).toMatchObject({
      kind: "skip",
      reason: "The 'summary' command is only supported on pull requests.",
    });
    // Standalone issue events are subscribed but not auto-actioned.
    expect(decide("issues", { action: "opened", repository: { full_name: repo }, issue: { number: 7 } })).toMatchObject({
      kind: "skip",
    });
  });

  it("resolves current gh login only after cheap gates say a trigger can use it", () => {
    expect(triggerMayNeedCurrentGitHubLogin({
      githubEvent: "pull_request",
      payload: prPayload("opened"),
      settings: settings(),
    })).toBe(true);
    expect(triggerMayNeedCurrentGitHubLogin({
      githubEvent: "pull_request",
      payload: prPayload("closed"),
      settings: settings(),
    })).toBe(false);
    expect(triggerMayNeedCurrentGitHubLogin({
      githubEvent: "pull_request",
      payload: prPayload("opened"),
      settings: settings({ autoReviewEnabled: false }),
    })).toBe(false);
    expect(triggerMayNeedCurrentGitHubLogin({
      githubEvent: "issue_comment",
      payload: { ...commentPayload("@rome-bot PTAL"), action: "edited" },
      settings: settings(),
    })).toBe(false);
    expect(triggerMayNeedCurrentGitHubLogin({
      githubEvent: "issue_comment",
      payload: commentPayload("@rome-bot PTAL"),
      settings: settings(),
    })).toBe(true);
  });

  it("parses exact commands with whitespace tolerance and rejects everything else", () => {
    const phrases = { reviewPhrase: "PTAL", summaryPhrase: "summary" };
    expect(parseStrictCommand("@rome-bot PTAL", login, phrases)).toBe("review");
    expect(parseStrictCommand("  @Rome-Bot   ptal \n", login, phrases)).toBe("review");
    expect(parseStrictCommand("@rome-bot summary", login, phrases)).toBe("summary");
    // Extra content of any kind → no command.
    expect(parseStrictCommand("@rome-bot summary please", login, phrases)).toBeNull();
    expect(parseStrictCommand("@rome-bot summarize the world", login, phrases)).toBeNull();
    expect(parseStrictCommand("hey @rome-bot summary", login, phrases)).toBeNull();
    expect(parseStrictCommand("@rome-bot ptable", login, phrases)).toBeNull();
    expect(parseStrictCommand("no mention here summary", login, phrases)).toBeNull();
    // Review wins if both phrases are configured identically.
    expect(parseStrictCommand("@rome-bot go", login, { reviewPhrase: "go", summaryPhrase: "go" })).toBe("review");
  });

  it("keeps actor ACL behavior", () => {
    expect(isTriggerActorAllowed("@Trusted-User", login, { allowlist: ["trusted-user"] })).toBe(true);
    expect(isTriggerActorAllowed("random-user", login, { allowlist: ["trusted-user"] })).toBe(false);
    expect(isTriggerActorAllowed(login, login, { allowlist: [] })).toBe(true);
  });

  it("allows everyone except blocked users in blocklist mode", () => {
    const policy = { mode: "blocklist" as const, blocklist: ["blocked-user"] };
    expect(isTriggerActorAllowed("any-contributor", login, policy)).toBe(true);
    expect(isTriggerActorAllowed("@Blocked-User", login, policy)).toBe(false);
    // The connected guardian account is always allowed, even if stale data lists it.
    expect(isTriggerActorAllowed(login, login, { mode: "blocklist", blocklist: [login] })).toBe(true);
    // Missing actor or guardian identity remains fail-closed.
    expect(isTriggerActorAllowed(null, login, policy)).toBe(false);
    expect(isTriggerActorAllowed("any-contributor", null, policy)).toBe(false);

    expect(decide("pull_request", prPayload("opened", "any-contributor"), {
      triggerAccessMode: "blocklist",
      triggerBlocklist: ["blocked-user"],
    })).toMatchObject({ kind: "trigger", actorLogin: "any-contributor" });
    expect(decide("pull_request", prPayload("opened", "blocked-user"), {
      triggerAccessMode: "blocklist",
      triggerBlocklist: ["blocked-user"],
    })).toMatchObject({
      kind: "skip",
      reason: "PR opener is in the review trigger blocklist.",
    });
    expect(decide("issue_comment", commentPayload("@rome-bot PTAL", "any-contributor"), {
      triggerAccessMode: "blocklist",
      triggerBlocklist: ["blocked-user"],
    })).toMatchObject({ kind: "trigger", actorLogin: "any-contributor" });
    expect(decide("issue_comment", commentPayload("@rome-bot summary", "blocked-user"), {
      triggerAccessMode: "blocklist",
      triggerBlocklist: ["blocked-user"],
    })).toMatchObject({
      kind: "skip",
      reason: "Mention trigger actor is in the review trigger blocklist.",
    });
  });

  it("fails closed when synchronize or review-request events omit the actual actor", () => {
    const synchronizeWithoutSender = prPayload("synchronize", "trusted-pr-author");
    delete synchronizeWithoutSender.sender;
    expect(decide("pull_request", synchronizeWithoutSender, {
      triggerAccessMode: "blocklist",
      triggerBlocklist: [],
    })).toMatchObject({
      kind: "skip",
      reason: "Could not identify the PR pusher for access filtering.",
    });

    const reviewRequestWithoutSender: GitHubWebhookPayload = {
      ...prPayload("review_requested", "trusted-pr-author"),
      requested_reviewer: { login },
    };
    delete reviewRequestWithoutSender.sender;
    expect(decide("pull_request", reviewRequestWithoutSender, {
      triggerAccessMode: "blocklist",
      triggerBlocklist: [],
    })).toMatchObject({
      kind: "skip",
      reason: "Could not identify the review requester for access filtering.",
    });

    // Opened events are intentionally authorized against the PR author, so a
    // missing sender does not erase the relevant identity for that event.
    const openedWithoutSender = prPayload("opened", "trusted-pr-author");
    delete openedWithoutSender.sender;
    expect(decide("pull_request", openedWithoutSender, {
      triggerAccessMode: "blocklist",
      triggerBlocklist: [],
    })).toMatchObject({
      kind: "trigger",
      actorLogin: "trusted-pr-author",
      triggerType: "pr_opened",
    });
  });

  it("rejects malformed or unsupported events before triggering", () => {
    expect(decidePRReviewTrigger({
      githubEvent: "pull_request",
      payload: { action: "opened", pull_request: { number: 42 } },
      settings: settings(),
      currentGitHubLogin: login,
    })).toEqual({ kind: "error", error: "Could not determine repository from webhook payload." });

    expect(decide("push", { action: "created", repository: { full_name: repo } })).toMatchObject({
      kind: "skip",
      reason: "Event 'push' is not a pull_request or issue_comment event.",
    });

    expect(decide("pull_request", { action: "opened", repository: { full_name: repo } })).toEqual({
      kind: "error",
      error: "Missing pull_request in webhook payload.",
    });
  });
});
