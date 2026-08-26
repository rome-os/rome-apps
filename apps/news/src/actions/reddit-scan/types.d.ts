/**
 * reddit_scan — Scan Reddit for posts matching configured queries and save them.
 *
 * Event-only action (no inputSchema). Triggered by the scheduler.
 * Iterates over a set of search queries across multiple subreddits, filters
 * results by exclude patterns, and bulk upserts new posts into the database.
 * Includes rate limiting (1.5s delay between requests).
 *
 * @example
 * // Typically scheduled as a recurring event:
 * await callAction("schedule_event", {
 *   name: "reddit_scan",
 *   type: "recurring",
 *   tzid: "America/Los_Angeles",
 *   localTime: "07:00",
 *   rrule: "FREQ=DAILY",
 *   actionName: "reddit_scan",
 *   args: [{}],
 * });
 *
 * // Or with custom scan config:
 * await callAction("reddit_scan", {
 *   scanName: "ml_papers",
 *   queries: ['"transformer architecture"', '"attention mechanism"'],
 *   subreddits: ["MachineLearning", "deeplearning"],
 *   time: "week",
 *   limitPerQuery: 10,
 * });
 */

export interface RedditScanInput {
  /** Name for this scan (used to group results in the DB). */
  scanName?: string;
  /** Search query strings (supports Reddit search syntax). */
  queries?: string[];
  /** Subreddits to search within (without "r/" prefix). */
  subreddits?: string[];
  /** Lowercase patterns — posts with titles matching these are excluded. */
  excludePatterns?: string[];
  /** Time filter for search (e.g. "hour", "day", "week"). */
  time?: string;
  /** Max posts to fetch per query per subreddit. */
  limitPerQuery?: number;
}

export interface RedditScanOutput {
  /** Name of the scan that was run. */
  scanName: string;
  /** Total number of posts scanned across all queries. */
  totalScanned: number;
  /** Number of new posts saved to the database. */
  totalNew: number;
  /** Error messages from failed queries, if any. */
  errors: string[];
}
