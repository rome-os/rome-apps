// Unit tests for the SM-2 lite scheduler (spec §10).
// Run with: pnpm test
import { expect, test } from "vitest";
import {
  AGAIN_REVIEW_GAP_MINUTES,
  MAX_EASE,
  MIN_EASE,
  NEW_CARD_EASE,
  schedule,
  type CardSchedulingState,
} from "./scheduler.ts";

const assert = {
  equal(actual: unknown, expected: unknown) {
    expect(actual).toBe(expected);
  },
  ok(value: unknown) {
    expect(value).toBeTruthy();
  },
};

const NOW = new Date("2026-06-22T09:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function newCard(): CardSchedulingState {
  return { ease: NEW_CARD_EASE, intervalDays: 0, reps: 0 };
}

test("grade Again (0) resets reps and interval, lowers ease, re-dues same day", () => {
  const r = schedule({ ease: 2.5, intervalDays: 12, reps: 4 }, 0, NOW);
  assert.equal(r.reps, 0);
  assert.equal(r.intervalDays, 0);
  assert.equal(r.ease, 2.3); // 2.5 - 0.2
  assert.equal(r.prevInterval, 12);
  // Due again the same day, nudged out by the short gap (not days).
  assert.equal(r.dueAt.getTime(), NOW.getTime() + AGAIN_REVIEW_GAP_MINUTES * 60 * 1000);
});

test("ease never drops below the 1.3 floor under repeated failures/hard", () => {
  // Repeated Again drops ease by 0.2 each time but clamps at MIN_EASE.
  let state: CardSchedulingState = { ease: 1.4, intervalDays: 5, reps: 3 };
  for (let i = 0; i < 5; i++) {
    const r = schedule(state, 0, NOW);
    state = { ease: r.ease, intervalDays: r.intervalDays, reps: r.reps };
  }
  assert.equal(state.ease, MIN_EASE);

  // Hard (grade 1) applies a -0.14 ease delta; repeated Hard also floors at 1.3.
  let hard: CardSchedulingState = newCard();
  for (let i = 0; i < 20; i++) {
    const r = schedule(hard, 1, NOW);
    hard = { ease: r.ease, intervalDays: r.intervalDays, reps: r.reps };
  }
  assert.equal(hard.ease, MIN_EASE);
});

test("ease never exceeds the 2.7 ceiling under repeated Easy", () => {
  let state = newCard();
  for (let i = 0; i < 10; i++) {
    const r = schedule(state, 3, NOW);
    state = { ease: r.ease, intervalDays: r.intervalDays, reps: r.reps };
  }
  assert.equal(state.ease, MAX_EASE);
});

test("ease deltas per grade match SM-2 (Hard -0.14, Good 0, Easy +0.1)", () => {
  assert.ok(Math.abs(schedule({ ease: 2.5, intervalDays: 0, reps: 0 }, 1, NOW).ease - 2.36) < 1e-9);
  assert.equal(schedule({ ease: 2.5, intervalDays: 0, reps: 0 }, 2, NOW).ease, 2.5);
  assert.ok(Math.abs(schedule({ ease: 2.5, intervalDays: 0, reps: 0 }, 3, NOW).ease - 2.6) < 1e-9);
});

test("interval growth across reps: 1 -> 3 -> round(prev*ease)", () => {
  // rep 1 (Good) -> interval 1
  let r = schedule(newCard(), 2, NOW);
  assert.equal(r.reps, 1);
  assert.equal(r.intervalDays, 1);
  assert.equal(r.dueAt.getTime(), NOW.getTime() + 1 * MS_PER_DAY);

  // rep 2 (Good) -> interval 3
  r = schedule({ ease: r.ease, intervalDays: r.intervalDays, reps: r.reps }, 2, NOW);
  assert.equal(r.reps, 2);
  assert.equal(r.intervalDays, 3);

  // rep 3 (Good) -> round(prev(3) * ease(2.5)) = round(7.5) = 8
  r = schedule({ ease: r.ease, intervalDays: r.intervalDays, reps: r.reps }, 2, NOW);
  assert.equal(r.reps, 3);
  assert.equal(r.ease, 2.5);
  assert.equal(r.intervalDays, 8); // Math.round(3 * 2.5)

  // rep 4 (Good) -> round(prev(8) * 2.5) = 20
  r = schedule({ ease: r.ease, intervalDays: r.intervalDays, reps: r.reps }, 2, NOW);
  assert.equal(r.intervalDays, 20);
});

test("rep 2 with Easy uses 6-day interval instead of 3", () => {
  const r1 = schedule(newCard(), 3, NOW); // rep 1, interval 1
  assert.equal(r1.intervalDays, 1);
  const r2 = schedule({ ease: r1.ease, intervalDays: r1.intervalDays, reps: r1.reps }, 3, NOW);
  assert.equal(r2.reps, 2);
  assert.equal(r2.intervalDays, 6);
});

test("prevInterval is reported for the review log", () => {
  const r = schedule({ ease: 2.5, intervalDays: 8, reps: 3 }, 2, NOW);
  assert.equal(r.prevInterval, 8);
});
