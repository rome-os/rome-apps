import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  db: {
    createQueuedPRReview: vi.fn(),
    getPRReviewSettings: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock("../../db/repositories/repo.js", () => ({
  createScanRepository: vi.fn(() => mocks.db),
}));

const config = {
  name: "code-review_pr-webhook",
  type: "custom" as const,
  description: "Handle GitHub webhook events",
  complexity: "simple" as const,
  speed: "fast" as const,
  reliability: "high" as const,
  sideEffects: "write" as const,
};

function makeDeps() {
  return {
    appContext: {
      db: {},
      runAction: vi.fn().mockResolvedValue({ status: "ok", data: {} }),
    },
  } as any;
}

function enableAllTriggers(overrides: Record<string, unknown> = {}) {
  mocks.db.getPRReviewSettings.mockReturnValue({
    autoReviewEnabled: true,
    triggerOnCreate: true,
    triggerOnRequest: true,
    triggerOnReviewRequest: true,
    triggerOnMention: true,
    triggerOnPush: true,
    triggerAllowlist: [],
    mentionTriggerPhrase: "PTAL",
    ...overrides,
  });
}

describe("pr-webhook action", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    enableAllTriggers();
    mocks.db.createQueuedPRReview.mockReturnValue({ id: "queued-review-id" });
    mocks.execFileSync.mockReturnValue("rome-bot\n");
  });

  it("accepts Routine event-bus pull_request input", async () => {
    enableAllTriggers({ triggerAllowlist: ["zoolsher"] });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "opened",
        repository: { full_name: "amantru/rome-apps" },
        sender: { login: "rome-bot" },
        pull_request: {
          number: 70,
          html_url: "https://github.com/amantru/rome-apps/pull/70",
          title: "Show queued review stages",
          user: { login: "zoolsher" },
          head: { sha: "abc123" },
        },
      },
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        queued: true,
        reviewId: "queued-review-id",
        repo: "amantru/rome-apps",
        prNumber: 70,
        triggeredBy: "webhook:opened",
      },
    });
    expect(mocks.db.createQueuedPRReview).toHaveBeenCalledWith({
      repo: "amantru/rome-apps",
      prNumber: 70,
      prUrl: "https://github.com/amantru/rome-apps/pull/70",
      prTitle: "Show queued review stages",
      prAuthor: "zoolsher",
      headSha: "abc123",
    });
    expect(deps.appContext.runAction).toHaveBeenCalledWith(
      "code-review:code-review_pr-review",
      {
        repo: "amantru/rome-apps",
        prNumber: 70,
        reviewId: "queued-review-id",
      },
      { detached: true },
    );
  });

  it("accepts Routine event-bus issue_comment PTAL input", async () => {
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "issue_comment",
      __triggerPayload: {
        action: "created",
        repository: { full_name: "amantru/rome-apps" },
        issue: { number: 72, pull_request: { url: "https://api.github.com/repos/amantru/rome-apps/pulls/72" } },
        comment: { id: 12345, body: "@rome-bot PTAL", user: { login: "rome-bot" } },
      },
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        queued: true,
        reviewId: "queued-review-id",
        repo: "amantru/rome-apps",
        prNumber: 72,
        triggeredBy: "webhook:created",
        triggerCommentId: 12345,
      },
    });
    expect(deps.appContext.runAction).toHaveBeenCalledWith(
      "code-review:code-review_pr-review",
      {
        repo: "amantru/rome-apps",
        prNumber: 72,
        reviewId: "queued-review-id",
        triggerCommentId: 12345,
      },
      { detached: true },
    );
  });

  it("skips issue_comment input unless it mentions the bot with PTAL", async () => {
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "issue_comment",
      __triggerPayload: {
        action: "created",
        repository: { full_name: "amantru/rome-apps" },
        issue: { number: 72, pull_request: {} },
        comment: { id: 12345, body: "Looks good" },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ skipped: true });
    expect(mocks.db.createQueuedPRReview).not.toHaveBeenCalled();
    expect(deps.appContext.runAction).not.toHaveBeenCalled();
  });

  it("accepts manual triggers when auto triggers are disabled", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: false,
      triggerOnCreate: true,
      triggerOnRequest: true,
      triggerOnReviewRequest: true,
      triggerOnMention: true,
      triggerOnPush: true,
      triggerAllowlist: [],
      mentionTriggerPhrase: "PTAL",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "review_requested",
        repository: { full_name: "amantru/rome-apps" },
        requested_reviewer: { login: "rome-bot" },
        sender: { login: "rome-bot" },
        pull_request: {
          number: 73,
          html_url: "https://github.com/amantru/rome-apps/pull/73",
          title: "Manual trigger split",
          user: { login: "zoolsher" },
          head: { sha: "def456" },
        },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ queued: true, prNumber: 73 });
    expect(deps.appContext.runAction).toHaveBeenCalled();
  });

  it("skips auto triggers when auto trigger is disabled", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: false,
      triggerOnCreate: true,
      triggerOnRequest: true,
      triggerOnReviewRequest: true,
      triggerOnMention: true,
      triggerOnPush: true,
      triggerAllowlist: [],
      mentionTriggerPhrase: "PTAL",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "opened",
        repository: { full_name: "amantru/rome-apps" },
        pull_request: { number: 74 },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ skipped: true });
    expect(mocks.db.createQueuedPRReview).not.toHaveBeenCalled();
    expect(deps.appContext.runAction).not.toHaveBeenCalled();
  });

  it("skips request review when requester is not guardian or allowlisted", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: false,
      triggerOnCreate: false,
      triggerOnRequest: true,
      triggerOnReviewRequest: true,
      triggerOnMention: true,
      triggerOnPush: false,
      triggerAllowlist: ["trusted-user"],
      mentionTriggerPhrase: "PTAL",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "review_requested",
        repository: { full_name: "amantru/rome-apps" },
        requested_reviewer: { login: "rome-bot" },
        sender: { login: "random-user" },
        pull_request: { number: 75 },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ skipped: true });
    expect(mocks.db.createQueuedPRReview).not.toHaveBeenCalled();
    expect(deps.appContext.runAction).not.toHaveBeenCalled();
  });

  it("fails closed for open-mode PR events without sender identity", async () => {
    enableAllTriggers({
      triggerAccessMode: "blocklist",
      triggerAllowlist: [],
      triggerBlocklist: [],
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const synchronizeResult = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "synchronize",
        repository: { full_name: "amantru/rome-apps" },
        pull_request: {
          number: 751,
          user: { login: "trusted-pr-author" },
        },
      },
    });

    const reviewRequestedResult = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "review_requested",
        repository: { full_name: "amantru/rome-apps" },
        requested_reviewer: { login: "rome-bot" },
        pull_request: {
          number: 752,
          user: { login: "trusted-pr-author" },
        },
      },
    });

    expect(synchronizeResult.status).toBe("ok");
    expect(synchronizeResult.data).toMatchObject({
      skipped: true,
      reason: "Could not identify the PR pusher for access filtering.",
    });
    expect(reviewRequestedResult.status).toBe("ok");
    expect(reviewRequestedResult.data).toMatchObject({
      skipped: true,
      reason: "Could not identify the review requester for access filtering.",
    });
    expect(mocks.db.createQueuedPRReview).not.toHaveBeenCalled();
    expect(deps.appContext.runAction).not.toHaveBeenCalled();
  });

  it("accepts PTAL when commenter is allowlisted", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: false,
      triggerOnCreate: false,
      triggerOnRequest: true,
      triggerOnReviewRequest: true,
      triggerOnMention: true,
      triggerOnPush: false,
      triggerAllowlist: ["trusted-user"],
      mentionTriggerPhrase: "PTAL",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "issue_comment",
      __triggerPayload: {
        action: "created",
        repository: { full_name: "amantru/rome-apps" },
        issue: { number: 76, pull_request: {} },
        comment: { id: 456, body: "@rome-bot PTAL", user: { login: "trusted-user" } },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ queued: true, prNumber: 76 });
    expect(deps.appContext.runAction).toHaveBeenCalledWith(
      "code-review:code-review_pr-review",
      {
        repo: "amantru/rome-apps",
        prNumber: 76,
        reviewId: "queued-review-id",
        triggerCommentId: 456,
      },
      { detached: true },
    );
  });

  it("skips auto trigger when opener is not guardian or allowlisted", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: true,
      triggerOnCreate: true,
      triggerOnRequest: false,
      triggerOnReviewRequest: true,
      triggerOnMention: true,
      triggerOnPush: false,
      triggerAllowlist: ["trusted-user"],
      mentionTriggerPhrase: "PTAL",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "opened",
        repository: { full_name: "amantru/rome-apps" },
        sender: { login: "random-user" },
        pull_request: { number: 77, user: { login: "random-user" } },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ skipped: true });
    expect(mocks.db.createQueuedPRReview).not.toHaveBeenCalled();
    expect(deps.appContext.runAction).not.toHaveBeenCalled();
  });

  it("skips review_requested when that manual sub-trigger is disabled", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: false,
      triggerOnCreate: false,
      triggerOnRequest: true,
      triggerOnReviewRequest: false,
      triggerOnMention: true,
      triggerOnPush: false,
      triggerAllowlist: [],
      mentionTriggerPhrase: "PTAL",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "pull_request",
      __triggerPayload: {
        action: "review_requested",
        repository: { full_name: "amantru/rome-apps" },
        requested_reviewer: { login: "rome-bot" },
        sender: { login: "rome-bot" },
        pull_request: { number: 78 },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ skipped: true });
    expect(mocks.db.createQueuedPRReview).not.toHaveBeenCalled();
  });

  it("accepts mention trigger with a custom phrase", async () => {
    mocks.db.getPRReviewSettings.mockReturnValue({
      autoReviewEnabled: false,
      triggerOnCreate: false,
      triggerOnRequest: true,
      triggerOnReviewRequest: false,
      triggerOnMention: true,
      triggerOnPush: false,
      triggerAllowlist: [],
      mentionTriggerPhrase: "please review",
    });
    const { createAction } = await import("./index.js");
    const deps = makeDeps();
    const action = createAction(config, deps);

    const result = await action.execute({
      githubEvent: "issue_comment",
      __triggerPayload: {
        action: "created",
        repository: { full_name: "amantru/rome-apps" },
        issue: { number: 79, pull_request: {} },
        comment: { id: 789, body: "@rome-bot please review", user: { login: "rome-bot" } },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ queued: true, prNumber: 79, triggerCommentId: 789 });
  });
});
