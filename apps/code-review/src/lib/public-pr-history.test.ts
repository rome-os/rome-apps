import { describe, expect, it } from "vitest";
import { publicPRHistory } from "./public-pr-history.js";
import type { MentionTask, PRReview } from "../db/repositories/repo.js";

const url = "https://github.com/o/r/pull/1";
const review = { id: "secret-review-id", repo: "o/r", prNumber: 1, prTitle: "private old title", prUrl: url,
  lensId: "custom", lensName: "private lens", lensInstructions: "private prompt", status: "completed",
  reviewComment: "Verdict: APPROVE — private notes", githubCommentUrl: `${url}#pullrequestreview-1`,
  startedAt: "2026-11-07T00:00:00Z", completedAt: null } as PRReview;
const task = { id: "secret-task-token", repo: "o/r", surface: "pr", number: 1, intent: "update-memory",
  status: "completed", commentBody: "private comment", createdAt: "2026-11-07T00:00:00Z", completedAt: null } as MentionTask;

describe("public history projection", () => {
  it.each([
    "https://internal.example/token", "javascript:alert(1)", "https://github.com/private/repo/pull/1#issuecomment-1",
    "https://github.com/o/r/pull/2#issuecomment-1", `${url}?secret=token#issuecomment-1`,
    `https://user:secret@github.com/o/r/pull/1#issuecomment-1`, `${url}#secret`, `${url}/files#issuecomment-1`,
  ])("omits non-public or off-PR result links: %s", badUrl => {
    const data = publicPRHistory("o/r", 1, [{ ...review, githubCommentUrl: badUrl }], [{ ...task, resultRef: JSON.stringify({ url: badUrl, body: "secret memory", error: "secret error" }) }]);
    expect(data.reviews[0].githubCommentUrl).toBeNull();
    expect(data.reviews[0].reviewComment).toBeNull();
    expect(data.tasks[0].resultRef).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/private|secret/);
  });

  it.each(["failed", "running", "cancelled"])("never exposes stored review output for %s runs", status => {
    expect(publicPRHistory("o/r", 1, [{ ...review, status }], []).reviews[0].reviewComment).toBeNull();
  });

  it("allows only fixed metadata, a verdict enum and same-PR GitHub links", () => {
    const data = publicPRHistory("o/r", 1, [review], [{ ...task, resultRef: JSON.stringify({ replyUrl: `${url}#issuecomment-1`, summary: "private summary" }) }]);
    expect(data.reviews[0]).toMatchObject({ id: "review-1", lensId: null, lensName: null, reviewComment: "Verdict: APPROVE" });
    expect(data.tasks[0]).toMatchObject({ id: "mention-1", commentBody: null, resultRef: JSON.stringify({ url: `${url}#issuecomment-1` }) });
    expect(JSON.stringify(data)).not.toMatch(/private|secret/);
  });

  it("omits malformed result JSON and unknown/custom status and intent strings", () => {
    const data = publicPRHistory("o/r", 1, [{ ...review, status: "private error" }], [{ ...task, resultRef: "{bad", status: "private error", intent: "private intent" }]);
    expect(data.reviews[0].status).toBe("unknown");
    expect(data.tasks[0]).toMatchObject({ status: "unknown", intent: "general", resultRef: null });
  });
});
