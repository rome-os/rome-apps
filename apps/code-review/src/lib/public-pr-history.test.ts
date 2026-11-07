import { describe, expect, it } from "vitest";
import { publicPRHistory } from "./public-pr-history.js";
import type { MentionTask, PRReview } from "../db/repositories/repo.js";
import type { PublishedPRHistory } from "./published-pr-history.js";

const url = "https://github.com/o/r/pull/1";
const review = { id: "secret-review-id", repo: "o/r", prNumber: 1, prTitle: "private old title", prUrl: url,
  lensId: "custom", lensName: "private lens", lensInstructions: "private prompt", status: "completed",
  reviewComment: "Verdict: APPROVE — private raw agent output and unposted finding", githubCommentUrl: `${url}#pullrequestreview-1`,
  romeSession: { _romeSessionId: "private session" }, stageHistory: "private error stack trace",
  startedAt: "2026-11-07T00:00:00Z", completedAt: null } as unknown as PRReview;
const task = { id: "secret-task-token", repo: "o/r", surface: "pr", number: 1, intent: "update-memory",
  status: "completed", commentBody: "private local request", actorLogin: "private requester", triggerCommentId: 123,
  resultRef: JSON.stringify({ url: `${url}#issuecomment-2`, body: "private project memory", editId: "private edit", error: "private logs" }),
  romeSession: { _romeSessionId: "private session" }, stageHistory: "private stack trace",
  createdAt: "2026-11-07T00:00:00Z", completedAt: null } as unknown as MentionTask;
const published: PublishedPRHistory = {
  reviews: [{ id: 1, html_url: `${url}#pullrequestreview-1`, body: "**Verdict:** APPROVE — published summary", state: "COMMENTED" }],
  inline: [{ html_url: `${url}#discussion_r3`, pull_request_review_id: 1, path: "src/api.ts", line: 42, body: "**[P1]** `security` — **Published finding**\n\nDetails" }],
  comments: [{ html_url: `${url}#issuecomment-2`, body: "Published acknowledgement only" }],
};
const project = (r = review, t = task, p = published) => publicPRHistory("o/r", 1, [r], [t], p);

describe("public history projection", () => {
  it("projects published summary, inline paths/lines/severity and reply, not local output", () => {
    const data = project();
    expect(data.reviews[0]).toMatchObject({ id: "review-1", lensId: null, lensName: null,
      reviewComment: published.reviews[0].body,
      findings: [{ path: "src/api.ts", line: 42, body: published.inline[0].body, url: `${url}#discussion_r3` }],
      lensInstructions: null, romeSession: null, stageHistory: null,
    });
    expect(data.tasks[0]).toMatchObject({ id: "mention-1", commentBody: null, actorLogin: null, triggerCommentId: null, romeSession: null, stageHistory: null });
    expect(JSON.parse(data.tasks[0].resultRef!)).toEqual({ url: `${url}#issuecomment-2`, body: published.comments[0].body });
    expect(JSON.stringify(data)).not.toMatch(/private|secret/);
  });

  it.each([
    "https://internal.example/token", "javascript:alert(1)", "https://github.com/private/repo/pull/1#issuecomment-1",
    "https://github.com/o/r/pull/2#issuecomment-1", `${url}?secret=token#issuecomment-1`,
    `https://user:secret@github.com/o/r/pull/1#issuecomment-1`, `${url}#secret`, `${url}/files#issuecomment-1`,
  ])("omits non-public or off-PR result links and associated text: %s", badUrl => {
    const data = project({ ...review, githubCommentUrl: badUrl }, { ...task, resultRef: JSON.stringify({ url: badUrl, body: "secret memory" }) });
    expect(data.reviews[0].githubCommentUrl).toBeNull();
    expect(data.reviews[0].reviewComment).toBeNull();
    expect(data.reviews[0].findings).toEqual([]);
    expect(data.tasks[0].resultRef).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/private|secret/);
  });

  it.each(["failed", "running", "cancelled", "queued", "posting", "skipped"])("shows status, not stored/pending output for %s runs", status => {
    const data = project({ ...review, status }, { ...task, status });
    expect(data.reviews[0].reviewComment).toBeNull();
    expect(data.reviews[0].findings).toEqual([]);
    expect(JSON.parse(data.tasks[0].resultRef!).body).toBeNull();
  });

  it("does not treat valid links, missing/deleted comments or pending drafts as publication proof", () => {
    const data = project(review, task, { ...published, reviews: [{ ...published.reviews[0], state: "PENDING" }], comments: [] });
    expect(data.reviews[0].reviewComment).toBeNull();
    expect(data.reviews[0].findings).toEqual([]);
    expect(JSON.parse(data.tasks[0].resultRef!).body).toBeNull();
    expect(publicPRHistory("o/r", 1, [review], [task]).reviews[0].reviewComment).toBeNull();
  });

  it("never exposes unpublished local runs or pending inline replies", () => {
    const local = project({ ...review, githubCommentUrl: null }, { ...task, resultRef: null });
    expect(local.reviews[0].reviewComment).toBeNull();
    expect(local.reviews[0].findings).toEqual([]);
    expect(local.tasks[0].resultRef).toBeNull();
    const pending = project(review, { ...task, resultRef: JSON.stringify({ replyUrl: `${url}#discussion_r3` }) },
      { ...published, reviews: [{ ...published.reviews[0], state: "PENDING" }] });
    expect(JSON.parse(pending.tasks[0].resultRef!).body).toBeNull();
  });

  it("omits inline comments from other reviews and unsafe links; uses original line for outdated findings", () => {
    const data = project(review, task, { ...published, inline: [
      { ...published.inline[0], line: null, original_line: 9 },
      { ...published.inline[0], pull_request_review_id: 99, body: "wrong review" },
      { ...published.inline[0], html_url: "https://github.com/private/repo/pull/1#discussion_r4", body: "private" },
    ] });
    expect(data.reviews[0].findings).toHaveLength(1);
    expect(data.reviews[0].findings[0].line).toBe(9);
    expect(JSON.stringify(data)).not.toMatch(/wrong review|private/);
  });

  it("supports legacy reviews posted as issue comments, and task replyUrl results", () => {
    const data = project({ ...review, githubCommentUrl: `${url}#issuecomment-2` },
      { ...task, intent: "summary", resultRef: JSON.stringify({ replyUrl: `${url}#issuecomment-2`, summary: "private summary" }) });
    expect(data.reviews[0].reviewComment).toBe(published.comments[0].body);
    expect(JSON.parse(data.tasks[0].resultRef!).body).toBe(published.comments[0].body);
    expect(data.tasks[0].intent).toBe("summary");
  });

  it("omits malformed result JSON and unknown/custom status and intent strings", () => {
    const data = project({ ...review, status: "private error" }, { ...task, resultRef: "{bad", status: "private error", intent: "private intent" });
    expect(data.reviews[0].status).toBe("unknown");
    expect(data.tasks[0]).toMatchObject({ status: "unknown", intent: "general", resultRef: null });
  });
});
