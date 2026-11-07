import type { MentionTask, PRReview } from "../db/repositories/repo.js";
import type { PublishedPRHistory } from "./published-pr-history.js";

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
 * GitHub is authoritative for text: local completed output may include raw agent
 * output or unposted findings; memory-task bodies include unpublished memory.
 * Match only validated same-PR result links to PR-scoped GitHub collections.
 * Explicit projections keep future DB/provider fields private by default.
 * Task ids are bearer capabilities in the submit flow: use page-local ids.
 */
export function publicPRHistory(
  repo: string, number: number, reviews: PRReview[], tasks: MentionTask[],
  published: PublishedPRHistory = { reviews: [], inline: [], comments: [] },
) {
  const url = `https://github.com/${repo}/pull/${number}`;
  return {
    repo,
    number,
    title: null,
    author: null,
    url,
    reviews: reviews.map((r, i) => {
      const githubCommentUrl = githubResultUrl(r.githubCommentUrl, url);
      const postedReview = r.status === "completed" && githubCommentUrl
        ? published.reviews.find(p => ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(p.state) && githubResultUrl(p.html_url, url) === githubCommentUrl)
        : undefined;
      // Older versions posted plain issue comments instead of PR reviews.
      const postedComment = r.status === "completed" && githubCommentUrl
        ? published.comments.find(p => githubResultUrl(p.html_url, url) === githubCommentUrl)
        : undefined;
      const findings = postedReview ? published.inline
        .filter(p => p.pull_request_review_id === postedReview.id && githubResultUrl(p.html_url, url))
        .map(p => ({
          path: typeof p.path === "string" ? p.path : "",
          line: Number.isSafeInteger(p.line) ? p.line : Number.isSafeInteger(p.original_line) ? p.original_line : null,
          body: typeof p.body === "string" ? p.body : "",
          url: githubResultUrl(p.html_url, url)!,
        })) : [];
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
        reviewComment: typeof (postedReview ?? postedComment)?.body === "string" ? (postedReview ?? postedComment)!.body : null,
        findings,
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
      const postedReply = t.status === "completed" && resultUrl
        ? published.comments.find(p => githubResultUrl(p.html_url, url) === resultUrl)
          ?? published.inline.find(p => githubResultUrl(p.html_url, url) === resultUrl
            && published.reviews.some(r => r.id === p.pull_request_review_id
              && ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(r.state)))
        : undefined;
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
        resultRef: resultUrl ? JSON.stringify({
          url: resultUrl,
          body: typeof postedReply?.body === "string" ? postedReply.body : null,
        }) : null,
        romeSession: null,
        actorLogin: null,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      };
    }),
  };
}
