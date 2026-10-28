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
    getPRReviewSettings: vi.fn(),
    getAppSetting: vi.fn(),
    completePRReview: vi.fn(),
    setPRReviewRomeSession: vi.fn(),
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


describe("pr-review lens execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.isPRReviewCancelled.mockReturnValue(false);
    mocks.db.getPRReviewSettings.mockReturnValue(null);
    mocks.db.getPreviousCompletedPRReviewByPR.mockReturnValue(undefined);
  });

  const config = { name: "code-review_pr-review", type: "custom", description: "Review",
    complexity: "moderate", speed: "moderate", reliability: "high", sideEffects: "write" } as const;

  it.each([null, "design-alternatives", "security"])("posts a separate COMMENT review with the correct heading and reactions for lens %s", async (lensId) => {
    const review = { id: "run", repo: "o/r", prNumber: 7, lensId,
      lensName: lensId === "design-alternatives" ? "Design & Alternatives" : lensId ? "Security" : null, lensInstructions: lensId ? "Snapshot: break it" : null };
    mocks.db.getPRReview.mockReturnValue(review);
    mocks.db.claimQueuedPRReview.mockReturnValue(review);
    mocks.db.getAppSetting.mockReturnValue("https://test.romeos.cc");
    mocks.execFileSync.mockImplementation((command, args) => {
      if (command === "git") return "";
      if (args[0] === "pr") return JSON.stringify({
        title: "Fix", author: { login: "author" }, url: "https://github.com/o/r/pull/7", body: "", headRefOid: "abc1234",
      });
      if (args[1]?.endsWith("/files")) return "[]";
      if (args[1]?.endsWith("/reviews")) return JSON.stringify({ html_url: "https://github.com/review" });
      return JSON.stringify({ id: 123 });
    });
    const invokeAction = vi.fn((..._args: any[]) => ({
      events: (async function* () {})(),
      result: Promise.resolve({ status: "ok", data: { output: {
        summary: "Examined change", verdict: "COMMENT", verdict_reason: "Review complete", findings: [],
      } } }),
    }));
    const { createAction } = await import("./index.js");
    const result = await createAction(config, { appContext: { db: {}, invokeAction } } as any).execute({
      repo: "o/r", prNumber: 7, reviewId: "run", triggerCommentId: 99,
    });
    expect(result.status).toBe("ok");
    expect(mocks.db.getPreviousCompletedPRReviewByPR).toHaveBeenCalledWith("o/r", 7, "run", lensId);
    const prompt = invokeAction.mock.calls[0][1].prompt;
    if (lensId) {
      expect(prompt).toContain(`## Reviewer mode: ${lensId}`);
      expect(prompt).toContain("Snapshot: break it");
      expect(prompt).not.toContain("take precedence");
    } else expect(prompt).not.toContain("Reviewer mode:");
    const postingCall = mocks.execFileSync.mock.calls.find(([, args]) => args[1]?.endsWith("/reviews"));
    const payload = JSON.parse(postingCall![2].input);
    expect(payload.event).toBe("COMMENT");
    expect(payload.body).toContain(`## ${review.lensName ?? "Code Review"}${lensId ? " review" : ""}: 💬 COMMENT`);
    expect(payload.body).toContain("Automated review by");
    expect(payload.body).toContain("Full review history");
    const reactionCalls = mocks.execFileSync.mock.calls.filter(([, args]) => args.some((a: string) => a.includes("/reactions")));
    expect(reactionCalls).toHaveLength(lensId ? 0 : 4); // Add + remove for PR and comment.
    expect(mocks.db.completePRReview).toHaveBeenCalledWith("run", expect.any(String), "https://github.com/review");
  });

  it("does not mark the triggering comment when a lens claim is skipped", async () => {
    mocks.db.getPRReview.mockReturnValue({ id: "run", repo: "o/r", prNumber: 7, lensId: "lens" });
    mocks.db.claimQueuedPRReview.mockReturnValue(null);
    mocks.execFileSync.mockReturnValue(JSON.stringify({ title: "Fix", headRefOid: "abc1234" }));
    const { createAction } = await import("./index.js");
    await createAction(config, { appContext: { db: {} } } as any).execute({
      repo: "o/r", prNumber: 7, reviewId: "run", triggerCommentId: 99,
    });
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1); // PR metadata only.
  });

  it("skips queued legacy custom runs without summoning or posting", async () => {
    const review = { id: "legacy", repo: "o/r", prNumber: 7, lensId: "old-custom-uuid" };
    mocks.db.getPRReview.mockReturnValue(review);
    mocks.db.claimQueuedPRReview.mockReturnValue(review);
    mocks.execFileSync.mockReturnValue(JSON.stringify({ title: "Fix", headRefOid: "abc" }));
    const invokeAction = vi.fn();
    const { createAction } = await import("./index.js");
    const result = await createAction(config, { appContext: { db: {}, invokeAction } } as any).execute({
      repo: "o/r", prNumber: 7, reviewId: "legacy",
    });
    expect(result).toMatchObject({ status: "ok", data: { status: "skipped" } });
    expect(mocks.db.skipPRReview).toHaveBeenCalledWith("legacy", "Custom reviewers are no longer supported.");
    expect(invokeAction).not.toHaveBeenCalled();
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
  });

  it("preserves the default prompt and explicitly preserves the schema for a lens", async () => {
    const { buildAgentPrompt } = await import("./index.js");
    const base = buildAgentPrompt("o/r", 7, { title: "Fix", body: "" }, null, null, null, false);
    expect(buildAgentPrompt("o/r", 7, { title: "Fix", body: "" }, null, null, null, false,
      { lensId: null, lensName: null, lensInstructions: null })).toBe(base);
    const lens = buildAgentPrompt("o/r", 7, { title: "Fix", body: "" }, null, null, null, false,
      { lensId: "security", lensName: "Security", lensInstructions: "Break it" });
    expect(lens).toContain("## Reviewer mode: security");
    expect(lens).not.toContain("take precedence");
  });
});
