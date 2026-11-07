/** Only fields read from GitHub's PR-scoped collections, never local agent output. */
export interface PublishedReview {
  id: number;
  html_url: string;
  body: string;
  state: string;
}
export interface PublishedComment {
  html_url: string;
  body: string;
  pull_request_review_id?: number;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}
export interface PublishedPRHistory {
  reviews: PublishedReview[];
  inline: PublishedComment[];
  comments: PublishedComment[];
}

/**
 * Each page is a separate budgeted subprocess (no unbounded --paginate process).
 * Fail closed on incomplete/oversized history, not back to stored private text.
 */
export async function readPublishedPRHistory(
  repo: string,
  number: number,
  readPage: (endpoint: string) => Promise<string>,
): Promise<PublishedPRHistory> {
  async function list<T>(endpoint: string): Promise<T[]> {
    const result: T[] = [];
    // Bound CPU/memory and GitHub work even for pathological PRs. The shared
    // 30/minute budget can refuse earlier; callers return 429, never partial text.
    for (let page = 1; page <= 10; page++) {
      const values: unknown = JSON.parse(await readPage(`${endpoint}?per_page=100&page=${page}`));
      if (!Array.isArray(values)) throw new Error("Invalid GitHub history page");
      result.push(...values);
      if (values.length < 100) return result;
    }
    throw new Error("GitHub history too large");
  }
  // Sequential: a public request never fans out into unbudgeted subprocesses.
  const reviews = await list<PublishedReview>(`repos/${repo}/pulls/${number}/reviews`);
  const inline = await list<PublishedComment>(`repos/${repo}/pulls/${number}/comments`);
  const comments = await list<PublishedComment>(`repos/${repo}/issues/${number}/comments`);
  return { reviews, inline, comments };
}
