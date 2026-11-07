import type { MentionTask, PRReview } from "../db/repositories/repo.js";

/** Only link to this PR, never to a private result repo or an internal URL. */
function githubResultUrl(value: unknown, prUrl: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const pr = new URL(prUrl);
    if (url.origin !== pr.origin || url.username || url.password || url.search) return null;
    if (url.pathname.toLowerCase() !== pr.pathname.toLowerCase()) return null;
    if (!/^#(?:pullrequestreview-\d+|discussion_r\d+|issuecomment-\d+)$/.test(url.hash)) return null;
    return `${prUrl}${url.hash}`;
  } catch {
    return null;
  }
}

const REVIEW_STATUSES = new Set([
  "queued", "fetching_pr_info", "pending", "cloning", "reviewing", "posting", "running",
  "completed", "failed", "cancelled", "skipped",
]);
const TASK_STATUSES = new Set(["queued", "running", "posting", "completed", "failed", "cancelled"]);
const LENSES: Record<string, string> = { security: "Security", "design-alternatives": "Design & Alternatives" };

/**
 * Public history is run metadata, not a dump of agent output. Even a completed
 * review's local text can contain unposted findings/raw output; task results can
 * contain private memory summaries and errors. Link to GitHub for the published
 * text instead. Explicit projections keep future DB columns private by default.
 * Task ids are bearer capabilities in the submit flow: use page-local ids.
 */
export function publicPRHistory(repo: string, number: number, reviews: PRReview[], tasks: MentionTask[]) {
  const url = `https://github.com/${repo}/pull/${number}`;
  return {
    repo,
    number,
    title: null,
    author: null,
    url,
    reviews: reviews.map((r, i) => {
      const githubCommentUrl = githubResultUrl(r.githubCommentUrl, url);
      const verdict = r.status === "completed" && githubCommentUrl
        ? r.reviewComment?.match(/Verdict:?\**\s*\**\s*(APPROVE|REQUEST[_ ]CHANGES|COMMENT)\b/i)?.[1]
        : null;
      const lensId = r.lensId && Object.hasOwn(LENSES, r.lensId) ? r.lensId : null;
      return {
        id: `review-${i + 1}`,
        repo,
        prNumber: number,
        prUrl: url,
        prTitle: "",
        prAuthor: null,
        headSha: null,
        lensId,
        lensName: lensId ? LENSES[lensId] : null,
        lensInstructions: null,
        status: REVIEW_STATUSES.has(r.status) ? r.status : "unknown",
        stageHistory: null,
        reviewComment: verdict ? `Verdict: ${verdict.toUpperCase().replace(" ", "_")}` : null,
        githubCommentUrl,
        romeSession: null,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      };
    }),
    tasks: tasks.map((t, i) => {
      let resultUrl: string | null = null;
      try {
        const result = JSON.parse(t.resultRef ?? "null");
        resultUrl = githubResultUrl(result?.url ?? result?.replyUrl ?? result?.prUrl, url);
      } catch { /* Malformed/legacy results stay private. */ }
      return {
        id: `mention-${i + 1}`,
        repo,
        surface: "pr" as const,
        number,
        headSha: null,
        triggerCommentId: null,
        intent: ["general", "summary", "update-memory", "code-task", "none"].includes(t.intent) ? t.intent : "general",
        commentBody: null,
        status: TASK_STATUSES.has(t.status) ? t.status : "unknown",
        stageHistory: null,
        resultRef: resultUrl ? JSON.stringify({ url: resultUrl }) : null,
        romeSession: null,
        actorLogin: null,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      };
    }),
  };
}
