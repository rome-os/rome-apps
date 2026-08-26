/**
 * daily_news — Fetch top news and send a morning digest to the guardian.
 *
 * Event-only action (no inputSchema). Triggered by the scheduler.
 * Fetches headlines from Google News RSS and HackerNews API, formats a
 * markdown digest, and sends it to the guardian's Telegram.
 *
 * @example
 * // Typically scheduled as a recurring morning event:
 * await callAction("schedule_event", {
 *   name: "morning_news",
 *   type: "recurring",
 *   tzid: "America/Los_Angeles",
 *   localTime: "08:00",
 *   rrule: "FREQ=DAILY",
 *   actionName: "daily_news",
 *   args: [{}],
 * });
 */

export type DailyNewsInput = Record<string, never>;

export interface DailyNewsOutput {
  /** Number of Google News headlines included. */
  googleNewsCount: number;
  /** Number of HackerNews stories included. */
  hackerNewsCount: number;
}
