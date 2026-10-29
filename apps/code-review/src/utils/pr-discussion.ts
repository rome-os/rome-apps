import { execFileSync } from "child_process";
import { createAppLogger } from "@rome-os/app-runtime";
import { sanitizeCliError } from "./cli-errors.js";

const log = createAppLogger("code-review_pr-discussion");

export interface ReviewEntry { author: string; state: string; body: string }
export interface InlineComment { id: number | null; inReplyTo: number | null; author: string; path: string; line: number | null; body: string }
export interface DiscussionComment { author: string; body: string }

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

/** Run a paginated `gh api ... --jq '[...]'` call and flatten its pages. */
function fetchPages(path: string, jq: string): Record<string, unknown>[] {
  const result = execFileSync(
    "gh",
    ["api", path, "--paginate", "--jq", jq],
    { encoding: "utf-8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
  );
  return result.trim().split("\n").filter(Boolean).flatMap((chunk) => {
    const page = JSON.parse(chunk);
    return Array.isArray(page) ? page : [];
  });
}

/** Review bodies, oldest first. Empty bodies without a meaningful state are dropped. */
export function fetchReviews(repoSlug: string, prNumber: number): ReviewEntry[] {
  try {
    return fetchPages(`repos/${repoSlug}/pulls/${prNumber}/reviews`, "[.[] | {author: .user.login, state: .state, body: .body}]")
      .map((r) => ({ author: String(r.author ?? "unknown"), state: String(r.state ?? ""), body: String(r.body ?? "").trim() }))
      .filter((r) => r.body || (r.state && r.state !== "COMMENTED"));
  } catch (err) {
    log.warn("Failed to fetch PR reviews", { repo: repoSlug, prNumber, error: sanitizeCliError(err) });
    return [];
  }
}

/** Inline review comments (including replies), oldest first. */
export function fetchInlineComments(repoSlug: string, prNumber: number): InlineComment[] {
  try {
    return fetchPages(
      `repos/${repoSlug}/pulls/${prNumber}/comments`,
      "[.[] | {id: .id, inReplyTo: .in_reply_to_id, author: .user.login, path: .path, line: (.line // .original_line), body: .body}]",
    )
      .map((c) => ({
        id: c.id == null ? null : Number(c.id),
        inReplyTo: c.inReplyTo == null ? null : Number(c.inReplyTo),
        author: String(c.author ?? "unknown"),
        path: String(c.path ?? ""),
        line: c.line == null ? null : Number(c.line),
        body: String(c.body ?? "").trim(),
      }))
      .filter((c) => c.body);
  } catch (err) {
    log.warn("Failed to fetch inline review comments", { repo: repoSlug, prNumber, error: sanitizeCliError(err) });
    return [];
  }
}

/** PR conversation (issue-thread) comments, oldest first. */
export function fetchDiscussion(repoSlug: string, prNumber: number): DiscussionComment[] {
  try {
    return fetchPages(`repos/${repoSlug}/issues/${prNumber}/comments`, "[.[] | {author: .user.login, body: .body}]")
      .map((c) => ({ author: String(c.author ?? "unknown"), body: String(c.body ?? "").trim() }))
      .filter((c) => c.body);
  } catch (err) {
    log.warn("Failed to fetch PR discussion comments", { repo: repoSlug, prNumber, error: sanitizeCliError(err) });
    return [];
  }
}

/** Group inline comments into threads (root first, then its replies), oldest thread first. */
export function groupInlineThreads(comments: InlineComment[]): InlineComment[][] {
  const threads = new Map<number | string, InlineComment[]>();
  comments.forEach((c, i) => {
    const key = c.inReplyTo ?? c.id ?? `orphan-${i}`;
    threads.set(key, [...(threads.get(key) ?? []), c]);
  });
  return [...threads.values()];
}

/** The most recent whole threads that fit in `limit` comments (at least one thread). */
export function recentInlineThreads(comments: InlineComment[], limit: number): InlineComment[] {
  const kept: InlineComment[][] = [];
  let count = 0;
  for (const thread of groupInlineThreads(comments).reverse()) {
    if (kept.length && count + thread.length > limit) break;
    kept.unshift(thread);
    count += thread.length;
  }
  return kept.flat();
}
