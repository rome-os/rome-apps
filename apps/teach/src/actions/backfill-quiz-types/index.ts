import {
  createAppLogger,
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createTeachRepository, type CardRow } from "../../db/repositories/teach.js";
import { normalizeAnswer } from "../../lib/review.js";

const log = createAppLogger("teach_backfill_quiz_types");

const BATCH_SIZE = 25;

const schema = z.object({});

interface Classification {
  id: string;
  quiz_type: "mcq" | "qa";
  options: string[] | null;
}

/** Keep at most 3 valid, distinct distractors that don't equal the answer. */
function sanitizeDistractors(back: string, options: string[] | null | undefined): string[] {
  const seen = new Set<string>([normalizeAnswer(back)]);
  const out: string[] = [];
  for (const raw of options ?? []) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = normalizeAnswer(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === 3) break;
  }
  return out;
}

function buildPrompt(cards: CardRow[]): string {
  const payload = cards.map((c) => ({ id: c.id, front: c.front, back: c.back }));
  return [
    "Classify these review cards into mcq or qa and generate distractors for mcq cards.",
    "Return EVERY id exactly once via submit_output.",
    "",
    "CARDS:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return defineAction({
    config,
    schema,
    execute: async () => {
      const repo = createTeachRepository(deps.appContext.db);
      const pending = repo.listUnclassifiedCards();
      if (pending.length === 0) {
        log.info("backfill: nothing to do");
        return {
          status: "ok",
          data: { upgraded: 0, mcq: 0, qa: 0, pending: 0, batches: 0 },
        };
      }

      let mcqCount = 0;
      let qaCount = 0;
      let batches = 0;

      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        batches += 1;
        const byId = new Map(batch.map((c) => [c.id, c]));

        // Ask the classifier agent; on any failure, default the whole batch to
        // qa so no card is left without a quiz_type (qa needs no options).
        let classifications: Classification[] = [];
        try {
          const res = await deps.appContext.runAction("summon", {
            agentName: "card-quizifier",
            prompt: buildPrompt(batch),
          });
          if (res.status === "ok") {
            const output = (res.data as { output?: { cards?: Classification[] } } | undefined)
              ?.output;
            if (output?.cards && Array.isArray(output.cards)) {
              classifications = output.cards;
            } else {
              log.warn("backfill: classifier returned no structured cards");
            }
          } else {
            log.warn("backfill: classifier summon non-ok", { status: res.status });
          }
        } catch (err) {
          log.warn("backfill: classifier threw", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const handled = new Set<string>();
        for (const c of classifications) {
          const card = byId.get(c.id);
          if (!card || handled.has(c.id)) continue;
          handled.add(c.id);

          if (c.quiz_type === "mcq") {
            const distractors = sanitizeDistractors(card.back, c.options);
            if (distractors.length === 3) {
              repo.updateCardQuiz(card.id, { quizType: "mcq", options: distractors });
              mcqCount += 1;
              continue;
            }
            // Not enough usable distractors → fall back to qa (no options needed).
            log.warn("backfill: mcq lacked 3 distractors, demoting to qa", { cardId: card.id });
          }
          repo.updateCardQuiz(card.id, { quizType: "qa", options: null });
          qaCount += 1;
        }

        // Any card the agent skipped defaults to qa.
        for (const card of batch) {
          if (handled.has(card.id)) continue;
          repo.updateCardQuiz(card.id, { quizType: "qa", options: null });
          qaCount += 1;
        }
      }

      const remaining = repo.listUnclassifiedCards().length;
      log.info("backfill complete", { mcq: mcqCount, qa: qaCount, batches, remaining });
      return {
        status: "ok",
        data: {
          upgraded: mcqCount + qaCount,
          mcq: mcqCount,
          qa: qaCount,
          batches,
          pending: remaining,
        },
      };
    },
  });
}
