// Unit tests for active-recall answer→verdict→grade derivation (spec §10b),
// and that the derived grade still drives the SM-2 scheduler correctly.
// Run with: pnpm test
import { expect, test } from "vitest";
import {
  buildMcqOptions,
  gradeMcq,
  normalizeAnswer,
  shuffle,
  verdictToGrade,
  type Verdict,
} from "./review.ts";
import { NEW_CARD_EASE, schedule, type CardSchedulingState } from "./scheduler.ts";

const assert = {
  deepEqual(actual: unknown, expected: unknown) {
    expect(actual).toEqual(expected);
  },
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

// ── mcq grading ────────────────────────────────────────────────────────────────
test("gradeMcq matches the correct answer tolerant of case/space/punctuation", () => {
  assert.equal(gradeMcq("O(log n)", "O(log n)"), "correct");
  assert.equal(gradeMcq("  o(log n).  ", "O(log n)"), "correct");
  assert.equal(gradeMcq("O(n)", "O(log n)"), "wrong");
});

// ── verdict → grade ──────────────────────────────────────────────────────────
test("verdictToGrade maps correct→Good, partial→Hard, wrong→Again", () => {
  assert.equal(verdictToGrade("correct"), 2);
  assert.equal(verdictToGrade("partial"), 1);
  assert.equal(verdictToGrade("wrong"), 0);
});

test("override_easy bumps ONLY a correct answer to Easy(3)", () => {
  assert.equal(verdictToGrade("correct", true), 3);
  // The bump is ignored for partial/wrong — system stays honest.
  assert.equal(verdictToGrade("partial", true), 1);
  assert.equal(verdictToGrade("wrong", true), 0);
});

// ── derivation → SM-2 (the five required cases) ───────────────────────────────
function gradeFor(verdict: Verdict, overrideEasy = false) {
  return schedule(newCard(), verdictToGrade(verdict, overrideEasy), NOW);
}

test("mcq correct → Good(2): reps→1, interval 1 day, ease unchanged", () => {
  const verdict = gradeMcq("low", "low");
  assert.equal(verdict, "correct");
  const r = schedule(newCard(), verdictToGrade(verdict), NOW);
  assert.equal(r.reps, 1);
  assert.equal(r.intervalDays, 1);
  assert.equal(r.ease, 2.5);
  assert.equal(r.dueAt.getTime(), NOW.getTime() + 1 * MS_PER_DAY);
});

test("mcq wrong → Again(0): reps→0, interval 0, ease drops, re-dues same day", () => {
  const verdict = gradeMcq("high", "low");
  assert.equal(verdict, "wrong");
  // Use a matured card so the ease drop and reset are visible.
  const r = schedule({ ease: 2.5, intervalDays: 8, reps: 3 }, verdictToGrade(verdict), NOW);
  assert.equal(r.reps, 0);
  assert.equal(r.intervalDays, 0);
  assert.equal(r.ease, 2.3);
  assert.ok(r.dueAt.getTime() > NOW.getTime());
  assert.ok(r.dueAt.getTime() < NOW.getTime() + MS_PER_DAY);
});

test("qa correct → Good(2): same SM-2 as mcq correct", () => {
  const r = gradeFor("correct");
  assert.equal(r.reps, 1);
  assert.equal(r.intervalDays, 1);
  assert.equal(r.ease, 2.5);
});

test("qa partial → Hard(1): reps advance but ease takes the Hard penalty (-0.14)", () => {
  const r = gradeFor("partial");
  assert.equal(r.reps, 1);
  assert.equal(r.intervalDays, 1);
  assert.ok(Math.abs(r.ease - 2.36) < 1e-9);
});

test("qa wrong → Again(0): reset like mcq wrong", () => {
  const r = schedule({ ease: 2.5, intervalDays: 8, reps: 3 }, verdictToGrade("wrong"), NOW);
  assert.equal(r.reps, 0);
  assert.equal(r.intervalDays, 0);
  assert.equal(r.ease, 2.3);
});

test("correct + too-easy bump → Easy(3): bigger ease bump and 6-day jump on rep 2", () => {
  const r1 = gradeFor("correct", true); // rep 1, interval 1, ease 2.6
  assert.equal(r1.reps, 1);
  assert.equal(r1.intervalDays, 1);
  assert.ok(Math.abs(r1.ease - 2.6) < 1e-9);
  const r2 = schedule({ ease: r1.ease, intervalDays: r1.intervalDays, reps: r1.reps }, 3, NOW);
  assert.equal(r2.reps, 2);
  assert.equal(r2.intervalDays, 6); // Easy uses 6 instead of 3 at rep 2
});

// ── option building / shuffle ────────────────────────────────────────────────
test("buildMcqOptions includes the correct answer + distractors, de-duplicated", () => {
  const opts = buildMcqOptions("low", ["high", "mid", "low", "high"], () => 0);
  assert.ok(opts.includes("low"));
  // duplicates of the answer and repeated distractors are dropped
  assert.equal(new Set(opts.map(normalizeAnswer)).size, opts.length);
  assert.ok(opts.length <= 3);
});

test("buildMcqOptions always keeps the answer even with no distractors", () => {
  const opts = buildMcqOptions("answer", null);
  assert.deepEqual(opts, ["answer"]);
});

test("shuffle is a permutation (no loss, no dup) for a given rng", () => {
  const input = ["a", "b", "c", "d"];
  const out = shuffle(input, () => 0.5);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.equal(out.length, input.length);
});
