import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  db: {
    createQueuedPRReview: vi.fn(),
    createFailedPRReview: vi.fn(),
    failPRReview: vi.fn(),
    getPRReview: vi.fn(),
    getPRReviewByPR: vi.fn(),
    getPreviousCompletedPRReviewByPR: vi.fn(),
    updatePRReviewStage: vi.fn(),
    claimQueuedPRReview: vi.fn(),
    skipPRReview: vi.fn(),
    isPRReviewCancelled: vi.fn(),
    cancelPRReview: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock("../../db/repositories/repo.js", () => ({
  createScanRepository: vi.fn(() => mocks.db),
}));

describe("pr-review action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.isPRReviewCancelled.mockReturnValue(false);
  });

  it("persists a failed review when initial PR lookup fails", async () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("HTTP 404: Not Found");
    });
    mocks.db.createQueuedPRReview.mockReturnValue({
      id: "failed-review-id",
      repo: "amantru/rome-apps",
      prNumber: 9999,
      prUrl: "https://github.com/amantru/rome-apps/pull/9999",
      prTitle: "PR #9999",
      prAuthor: null,
      headSha: null,
      status: "queued",
      stageHistory: JSON.stringify([{ stage: "queued", time: 1778976000000 }]),
      reviewComment: null,
      githubCommentUrl: null,
      startedAt: "2026-05-17T00:00:00.000Z",
      completedAt: null,
    });
    const { createAction } = await import("./index.js");
    const agentRunner = { run: vi.fn() };
    const action = createAction(
      {
        name: "code-review_pr-review",
        type: "custom",
        description: "Review a PR",
        complexity: "moderate",
        speed: "moderate",
        reliability: "high",
        sideEffects: "write",
      },
      {
        appContext: { db: {} },
        agentRunner,
      } as any,
    );

    const result = await action.execute({ repo: "amantru/rome-apps", prNumber: 9999 });

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch PR #9999 from amantru/rome-apps: Not found. The repository or PR may not exist, or you may lack access.",
    });
    expect(mocks.db.createQueuedPRReview).toHaveBeenCalledWith({ repo: "amantru/rome-apps", prNumber: 9999 });
    expect(mocks.db.updatePRReviewStage).toHaveBeenCalledWith("failed-review-id", "fetching_pr_info");
    expect(mocks.db.failPRReview).toHaveBeenCalledWith(
      "failed-review-id",
      "Failed to fetch PR #9999 from amantru/rome-apps: Not found. The repository or PR may not exist, or you may lack access.",
    );
    expect(mocks.db.createFailedPRReview).not.toHaveBeenCalled();
    expect(agentRunner.run).not.toHaveBeenCalled();
  });

  it("marks the trigger comment with a confused reaction when the review is skipped", async () => {
    // gh pr view returns valid PR info; the claim then fails (an in-progress
    // review for the same commit already owns it), driving the skip branch.
    mocks.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("pr") && args.includes("view")) {
        return JSON.stringify({
          title: "PR #42",
          author: { login: "octocat" },
          url: "https://github.com/amantru/rome-apps/pull/42",
          body: "",
          headRefOid: "abc1234def",
        });
      }
      // reaction POST (and any other gh api call) returns a benign payload
      return JSON.stringify({ id: 555 });
    });
    mocks.db.createQueuedPRReview.mockReturnValue({
      id: "queued-review-id",
      repo: "amantru/rome-apps",
      prNumber: 42,
      status: "queued",
      stageHistory: "[]",
      reviewComment: null,
      githubCommentUrl: null,
      startedAt: "2026-05-17T00:00:00.000Z",
      completedAt: null,
    });
    // Claim fails → skip path.
    mocks.db.claimQueuedPRReview.mockReturnValue(null);

    const { createAction } = await import("./index.js");
    const action = createAction(
      {
        name: "code-review_pr-review",
        type: "custom",
        description: "Review a PR",
        complexity: "moderate",
        speed: "moderate",
        reliability: "high",
        sideEffects: "write",
      },
      { appContext: { db: {} }, agentRunner: { run: vi.fn() } } as any,
    );

    const result = await action.execute({
      repo: "amantru/rome-apps",
      prNumber: 42,
      triggerCommentId: 987654,
    });

    expect(result.status).toBe("ok");
    expect((result as any).data.status).toBe("already-reviewed");
    expect(mocks.db.skipPRReview).toHaveBeenCalledWith("queued-review-id", expect.any(String));

    // A confused reaction was posted to the triggering comment.
    const reactionCall = mocks.execFileSync.mock.calls.find(
      ([, args]) =>
        Array.isArray(args) &&
        args.some((a: string) => a.includes("issues/comments/987654/reactions")),
    );
    expect(reactionCall).toBeDefined();
    expect(reactionCall?.[2]).toMatchObject({ input: JSON.stringify({ content: "confused" }) });
  });
});
