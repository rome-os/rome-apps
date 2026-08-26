/**
 * daily_gre_word — Send a daily GRE vocabulary word to the guardian.
 *
 * Event-only action (no inputSchema). Triggered by the scheduler.
 * Picks the next word from an embedded vocabulary list, formats it with
 * pronunciation, definition, example sentence, etymology, and synonyms,
 * then sends it to the guardian's Telegram.
 *
 * @example
 * // Typically scheduled as a recurring daily event:
 * await callAction("schedule_event", {
 *   name: "gre_word",
 *   type: "recurring",
 *   tzid: "America/Los_Angeles",
 *   localTime: "09:00",
 *   rrule: "FREQ=DAILY",
 *   actionName: "daily_gre_word",
 *   args: [{}],
 * });
 */

export type DailyGreWordInput = Record<string, never>;

export interface DailyGreWordOutput {
  /** The vocabulary word that was sent. */
  word: string;
  /** Index of the word in the vocabulary list. */
  index: number;
}
