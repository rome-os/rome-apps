import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository } from "../../db/repositories/teach.js";
import { createSummonJudge, type QaJudge } from "../../lib/judge.js";
import { gradeMcq, verdictToGrade, type Verdict } from "../../lib/review.js";
import { GRADE_LABELS, schedule, type CardSchedulingState } from "../../lib/scheduler.js";
import { serializeCard } from "../../lib/wire.js";

const log = createAppLogger("teach_grade_review");

// The learner submits an ANSWER, not a grade. For mcq they pass the option text
// they picked; for qa they pass their free-text answer. The SM-2 grade is
// DERIVED here (correct→Good, partial→Hard, wrong→Again), with one opt-in bump
// (override_easy) honored ONLY for a correct answer (spec §10b).
//
// The "too easy → Easy" bump is a REVISION: the client re-calls with the prior
// review id (replace_review_id) and override_easy. We restore the card's
// pre-review state, drop the prior review, and re-apply SM-2 once — so the
// scheduler math is never applied twice for the same recall.
const schema = z.object({
  card_id: z.string().trim().min(1).describe("Card being reviewed"),
  selected_option: z
    .string()
    .trim()
    .optional()
    .describe("For mcq cards: the exact text of the option the learner picked"),
  text: z
    .string()
    .trim()
    .optional()
    .describe("For qa cards: the learner's free-text answer (AI-judged against the card's answer)"),
  override_easy: z
    .boolean()
    .optional()
    .describe("Honored ONLY when the answer is correct: bump the grade from Good to Easy"),
  replace_review_id: z
    .string()
    .trim()
    .optional()
    .describe(
      "Internal: revise a just-committed review (the 'too easy → Easy' bump). Restores pre-review state and re-applies SM-2 once.",
    ),
});

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  // Default judge summons the `judge` agent; tests inject a stub instead.
  const judge: QaJudge = createSummonJudge(
    (name, args) => deps.appContext.runAction(name, args),
    log,
  );

  return defineAction({
    config,
    schema,
    execute: async (input) => {
      const repo = createTeachRepository(deps.appContext.db);
      const card = repo.getCard(input.card_id);
      if (!card) {
        return { status: "error", error: `Card not found: ${input.card_id}` };
      }

      const quizType = card.quizType === "mcq" ? "mcq" : "qa";

      // ── Revision path: the "too easy → Easy" bump ──────────────────────────
      // Restore the snapshot from the prior review, delete it, and re-grade from
      // that pre-state. We reuse the prior verdict (no re-judging) and only honor
      // the bump when that verdict was correct.
      if (input.replace_review_id) {
        const prior = repo.getReview(input.replace_review_id);
        if (!prior || prior.cardId !== card.id) {
          return { status: "error", error: "Prior review not found for this card" };
        }
        if (prior.verdict !== "correct") {
          return { status: "error", error: "Only a correct answer can be bumped to Easy" };
        }
        const base: CardSchedulingState = {
          ease: prior.prevEase ?? card.ease,
          intervalDays: prior.prevInterval,
          reps: prior.prevReps ?? card.reps,
        };
        repo.deleteReview(prior.id);
        const verdict: Verdict = "correct";
        const grade = verdictToGrade(verdict, input.override_easy === true);
        const result = schedule(base, grade);
        const updated = repo.updateCardSchedule(card.id, {
          ease: result.ease,
          intervalDays: result.intervalDays,
          reps: result.reps,
          dueAt: result.dueAt,
        });
        const written = repo.createReview({
          cardId: card.id,
          grade,
          prevInterval: result.prevInterval,
          newInterval: result.intervalDays,
          prevEase: base.ease,
          prevReps: base.reps,
          quizType,
          verdict,
        });
        log.info("review revised (bump)", { cardId: card.id, grade, gradeLabel: GRADE_LABELS[grade] });
        return {
          status: "ok",
          data: {
            reviewId: written.id,
            verdict,
            feedback: "Marked as easy — pushed further out.",
            grade,
            gradeLabel: GRADE_LABELS[grade],
            correctAnswer: card.back,
            card: serializeCard(updated!),
            nextDueAt: result.dueAt.getTime(),
            intervalDays: result.intervalDays,
            ease: result.ease,
            reps: result.reps,
          },
        };
      }

      // ── Normal submission path ─────────────────────────────────────────────
      let verdict: Verdict;
      let feedback = "";

      if (quizType === "mcq") {
        const picked = input.selected_option;
        if (picked == null || picked.length === 0) {
          return { status: "error", error: "selected_option is required for an mcq card" };
        }
        verdict = gradeMcq(picked, card.back);
        feedback =
          verdict === "correct" ? "Correct!" : `Not quite — the answer is: ${card.back}`;
      } else {
        const answer = input.text;
        if (answer == null || answer.length === 0) {
          return { status: "error", error: "text answer is required for a qa card" };
        }
        const judged = await judge({ question: card.front, expected: card.back, answer });
        verdict = judged.verdict;
        feedback = judged.feedback;
      }

      const grade = verdictToGrade(verdict, input.override_easy === true);
      const base: CardSchedulingState = {
        ease: card.ease,
        intervalDays: card.intervalDays,
        reps: card.reps,
      };
      const result = schedule(base, grade);

      const updated = repo.updateCardSchedule(card.id, {
        ease: result.ease,
        intervalDays: result.intervalDays,
        reps: result.reps,
        dueAt: result.dueAt,
      });

      const written = repo.createReview({
        cardId: card.id,
        grade,
        prevInterval: result.prevInterval,
        newInterval: result.intervalDays,
        prevEase: base.ease,
        prevReps: base.reps,
        quizType,
        verdict,
      });

      log.info("review graded", {
        cardId: card.id,
        quizType,
        verdict,
        grade,
        gradeLabel: GRADE_LABELS[grade],
        intervalDays: result.intervalDays,
        dueAt: result.dueAt.toISOString(),
      });

      return {
        status: "ok",
        data: {
          reviewId: written.id,
          verdict,
          feedback,
          grade,
          gradeLabel: GRADE_LABELS[grade],
          // The correct answer, revealed only after the learner has submitted.
          correctAnswer: card.back,
          // Whether the learner may bump this to Easy (correct answers only).
          canBumpEasy: verdict === "correct" && grade !== 3,
          card: serializeCard(updated!),
          nextDueAt: result.dueAt.getTime(),
          intervalDays: result.intervalDays,
          ease: result.ease,
          reps: result.reps,
        },
      };
    },
  });
}
