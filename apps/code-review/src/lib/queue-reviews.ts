import type { RomeAppContext } from "@rome-os/app-runtime";
import type { ScanRepository } from "../db/repositories/repo.js";

/** Persist all runs before detached dispatch; each action claims its own lens. */
export async function queueReviews(
  db: ScanRepository,
  runAction: RomeAppContext["runAction"],
  input: Parameters<ScanRepository["createQueuedPRReview"]>[0] & { triggerCommentId?: number | null; requestNote?: string; reviewAgentIds?: string[] },
) {
  const { triggerCommentId, requestNote, reviewAgentIds, ...metadata } = input;
  const reviews = [
    ...(!reviewAgentIds || reviewAgentIds.includes("review") ? [db.createQueuedPRReview(metadata)] : []),
    ...db.listReviewLenses(input.repo).filter((lens) => lens.enabled && (!reviewAgentIds || reviewAgentIds.includes(lens.id))).map((lens) =>
      db.createQueuedPRReview({
        ...metadata,
        lensId: lens.id,
        lensName: lens.name,
        lensInstructions: lens.instructions,
      }),
    ),
  ];
  await Promise.all(reviews.map(async (review) => {
    try {
      await runAction(
        "code-review:code-review_pr-review",
        {
          repo: input.repo,
          prNumber: input.prNumber,
          reviewId: review.id,
          ...(triggerCommentId ? { triggerCommentId } : {}),
          ...(requestNote ? { requestNote } : {}),
        },
        { detached: true },
      );
    } catch (error) {
      db.failPRReview(review.id, `Failed to dispatch review: ${String(error)}`);
    }
  }));
  return reviews;
}
