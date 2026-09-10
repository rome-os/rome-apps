// AI judge for free-text (qa) answers (spec §10b).
//
// The judge is modular and injectable: `grade_review` derives the SM-2 grade
// from a `Verdict` (see review.ts), and the *only* place an LLM is involved is
// producing that verdict for qa cards. Tests pass a stub judge, so the
// derivation logic never needs a live model.

import type { Verdict } from "./review.js";

export interface QaJudgeInput {
  question: string;
  /** The canonical/expected answer (the card's `back`). */
  expected: string;
  /** The learner's free-text submission. */
  answer: string;
}

export interface QaJudgeResult {
  verdict: Verdict;
  feedback: string;
}

/** A function that judges one free-text answer. Injectable for testing. */
export type QaJudge = (input: QaJudgeInput) => Promise<QaJudgeResult>;

const VALID_VERDICTS: Verdict[] = ["correct", "partial", "wrong"];

function coerceVerdict(raw: unknown): Verdict | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (VALID_VERDICTS as string[]).includes(v) ? (v as Verdict) : null;
}

/**
 * Parse whatever a summon returned into a {verdict, feedback}. Tolerates the
 * structured `output` payload, a JSON blob inside the prose `result`, or a bare
 * verdict word. Returns null when nothing usable is found (caller falls back).
 */
export function parseJudgeOutput(data: unknown): QaJudgeResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // Preferred: agent submitted structured output via submit_output.
  const structured = (d.output ?? d) as Record<string, unknown>;
  if (structured && typeof structured === "object") {
    const verdict = coerceVerdict(structured.verdict);
    if (verdict) {
      const feedback =
        typeof structured.feedback === "string" ? structured.feedback : "";
      return { verdict, feedback };
    }
  }

  // Fallback: try to find JSON or a verdict word inside the prose result.
  const text = typeof d.result === "string" ? d.result : "";
  if (text) {
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]) as Record<string, unknown>;
        const verdict = coerceVerdict(obj.verdict);
        if (verdict) {
          return {
            verdict,
            feedback: typeof obj.feedback === "string" ? obj.feedback : "",
          };
        }
      } catch {
        // not JSON — fall through
      }
    }
    const word = text.toLowerCase().match(/\b(correct|partial|wrong)\b/);
    if (word) return { verdict: word[1] as Verdict, feedback: text.slice(0, 200) };
  }

  return null;
}

function buildJudgePrompt(input: QaJudgeInput): string {
  return [
    "Judge a learner's free-text answer to a flashcard question.",
    "",
    `QUESTION: ${input.question}`,
    `EXPECTED ANSWER (canonical): ${input.expected}`,
    `LEARNER'S ANSWER: ${input.answer}`,
    "",
    "Grade the learner's answer against the expected answer for conceptual",
    "correctness (ignore wording, phrasing, and minor omissions):",
    "  - correct: captures the key idea(s) accurately.",
    "  - partial: on the right track but missing or muddling something important.",
    "  - wrong: incorrect, irrelevant, or empty.",
    "",
    "Call submit_output exactly once with { verdict, feedback } where verdict is",
    "one of correct|partial|wrong and feedback is one short, encouraging sentence",
    "telling the learner what they got right or missed.",
  ].join("\n");
}

type RunAction = (name: string, args: Record<string, unknown>) => Promise<{
  status: string;
  data?: unknown;
  error?: string;
}>;

/**
 * Default judge: summons the `judge` agent and parses its verdict. Robust to
 * failure — any error, non-ok status, or unparseable response degrades to a
 * `partial` verdict with an explanatory note, so a review never crashes.
 */
export function createSummonJudge(
  runAction: RunAction,
  log?: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): QaJudge {
  return async (input) => {
    try {
      const res = await runAction("summon", {
        agentName: "judge",
        prompt: buildJudgePrompt(input),
      });
      if (res.status !== "ok") {
        log?.warn("judge summon non-ok", { status: res.status, error: res.error });
        return {
          verdict: "partial",
          feedback: "Couldn't auto-grade this answer, so it's counted as partial.",
        };
      }
      const parsed = parseJudgeOutput(res.data);
      if (!parsed) {
        log?.warn("judge output unparseable");
        return {
          verdict: "partial",
          feedback: "Couldn't auto-grade this answer, so it's counted as partial.",
        };
      }
      return parsed;
    } catch (err) {
      log?.warn("judge threw", { error: err instanceof Error ? err.message : String(err) });
      return {
        verdict: "partial",
        feedback: "Couldn't auto-grade this answer, so it's counted as partial.",
      };
    }
  };
}
