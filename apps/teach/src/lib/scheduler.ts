// SM-2 lite spaced-repetition scheduler (design spec §5).
//
// This is a pure module — no DB, no clock except the `now` you pass in — so it
// is trivially unit-testable (see scheduler.test.ts). The grade actions and the
// card defaults both go through here, keeping scheduling in one place.

/** Grade given to a review attempt. 0=Again, 1=Hard, 2=Good, 3=Easy. */
export type Grade = 0 | 1 | 2 | 3;

export const GRADE_LABELS: Record<Grade, string> = {
  0: "Again",
  1: "Hard",
  2: "Good",
  3: "Easy",
};

/** The schedulable state stored on a card. */
export interface CardSchedulingState {
  /** SM-2 ease factor. New cards start at 2.5. */
  ease: number;
  /** Current interval in whole days. New cards start at 0. */
  intervalDays: number;
  /** Number of successful repetitions in a row. New cards start at 0. */
  reps: number;
}

export interface ScheduleResult {
  ease: number;
  intervalDays: number;
  reps: number;
  /** When the card next becomes due. */
  dueAt: Date;
  /** The interval the card had *before* this review (logged on the review row). */
  prevInterval: number;
}

/** Defaults for a freshly created card (immediately due so it enters the queue). */
export const NEW_CARD_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 2.7;

/** When a card is failed (grade 0), it comes back the same day after this gap. */
export const AGAIN_REVIEW_GAP_MINUTES = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Apply one review to a card's scheduling state and return the next state.
 *
 * Algorithm (spec §5):
 * - grade 0 (Again): reps→0, interval→0 (due again same day, +10min),
 *   ease→max(1.3, ease-0.2).
 * - grade >=1: reps+=1; ease→clamp(1.3, ease + (0.1 - (3-g)*(0.08 + (3-g)*0.02)), 2.7);
 *   interval: reps1→1, reps2→3 (or 6 if Easy), else round(prevInterval * ease).
 * - dueAt = now + intervalDays (or now + 10min when intervalDays is 0).
 */
export function schedule(
  state: CardSchedulingState,
  grade: Grade,
  now: Date = new Date(),
): ScheduleResult {
  const prevInterval = state.intervalDays;

  if (grade === 0) {
    const ease = Math.max(MIN_EASE, state.ease - 0.2);
    return {
      ease,
      intervalDays: 0,
      reps: 0,
      // Same-day re-review: nudge it out by a short gap rather than now-exactly.
      dueAt: new Date(now.getTime() + AGAIN_REVIEW_GAP_MINUTES * MS_PER_MINUTE),
      prevInterval,
    };
  }

  const reps = state.reps + 1;
  const easeDelta = 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02);
  const ease = clamp(MIN_EASE, state.ease + easeDelta, MAX_EASE);

  let intervalDays: number;
  if (reps === 1) {
    intervalDays = 1;
  } else if (reps === 2) {
    intervalDays = grade === 3 ? 6 : 3;
  } else {
    intervalDays = Math.round(prevInterval * ease);
  }

  return {
    ease,
    intervalDays,
    reps,
    dueAt: new Date(now.getTime() + intervalDays * MS_PER_DAY),
    prevInterval,
  };
}
