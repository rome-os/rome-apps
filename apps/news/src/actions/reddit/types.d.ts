/**
 * reddit — Search Reddit or browse subreddit posts.
 *
 * Agent-callable action. Provides Reddit search and browsing capabilities
 * using Reddit's public JSON API (no authentication required).
 *
 * @example
 * // Search across Reddit
 * await callAction("reddit", {
 *   action: "search",
 *   query: "AI agents framework",
 *   sort: "relevance",
 *   time: "week",
 *   limit: 10,
 * });
 *
 * // Browse hot posts in a subreddit
 * await callAction("reddit", {
 *   action: "hot",
 *   subreddit: "MachineLearning",
 *   limit: 15,
 * });
 */

export interface RedditInput {
  /** The type of Reddit query to perform. */
  action: "search" | "hot" | "new" | "top";
  /** Search query string (required when action is "search"). */
  query?: string;
  /** Subreddit name without "r/" prefix (required for "hot", "new", "top"). */
  subreddit?: string;
  /** Sort order for search results. */
  sort?: "relevance" | "hot" | "top" | "new" | "comments";
  /** Time filter for "top" and "search" actions. */
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
  /** Maximum number of posts to return. Defaults to 25. */
  limit?: number;
}

export interface RedditPost {
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  url: string;
  selftext: string;
  createdUtc: number;
}

export interface RedditOutput {
  /** Array of matching Reddit posts. */
  posts: RedditPost[];
  /** Number of posts returned. */
  count: number;
}
