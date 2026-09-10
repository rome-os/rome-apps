// Pure active-recall review logic (spec §10b).
//
// This module has NO DB, NO LLM, and no clock — everything here is a pure
// function so the answer→verdict→grade derivation is trivially unit-testable
// (see review.test.ts). The AI judge for free-text (qa) answers lives in
// `judge.ts`; only its *result* (a verdict) flows through `verdictToGrade`.

import type { Grade } from "./scheduler.js";

/** How a card is reviewed: pick-one (mcq) or free-text recall (qa). */
export type QuizType = "mcq" | "qa";

/** Outcome of judging a single answer. mcq only ever yields correct|wrong. */
export type Verdict = "correct" | "partial" | "wrong";

/** Normalize an answer for tolerant string comparison (mcq option matching). */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");
}

/**
 * Grade an mcq submission by comparing the picked option to the correct answer
 * (`back`). Robust to whitespace/case/trailing-punctuation differences.
 */
export function gradeMcq(selectedOption: string, back: string): "correct" | "wrong" {
  return normalizeAnswer(selectedOption) === normalizeAnswer(back) ? "correct" : "wrong";
}

/**
 * Map a (system-derived) verdict to an SM-2 grade:
 *   correct → Good(2)   (or Easy(3) when the learner flags "too easy")
 *   partial → Hard(1)
 *   wrong   → Again(0)
 * The `overrideEasy` bump is ONLY honored for a correct answer (spec §10b).
 */
export function verdictToGrade(verdict: Verdict, overrideEasy = false): Grade {
  switch (verdict) {
    case "correct":
      return overrideEasy ? 3 : 2;
    case "partial":
      return 1;
    case "wrong":
      return 0;
  }
}

/** Deterministic-friendly Fisher–Yates shuffle (rng defaults to Math.random). */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the shuffled option list shown for an mcq card: the correct answer
 * (`back`) plus its distractors, de-duplicated and shuffled. The correct answer
 * is always included even if distractors are missing/short.
 */
export function buildMcqOptions(
  back: string,
  distractors: readonly string[] | null | undefined,
  rng: () => number = Math.random,
): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const candidate of [back, ...(distractors ?? [])]) {
    const value = candidate?.trim();
    if (!value) continue;
    const key = normalizeAnswer(value);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(value);
  }
  return shuffle(options, rng);
}
