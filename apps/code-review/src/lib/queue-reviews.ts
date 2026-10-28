import type { RomeAppContext } from "@rome-os/app-runtime";
import type { ScanRepository } from "../db/repositories/repo.js";

/** Persist all runs before detached dispatch; each action claims its own lens. */
export async function queueReviews(
  db: ScanRepository,
  runAction: RomeAppContext["runAction"],
  input: Parameters<ScanRepository["createQueuedPRReview"]>[0] & { triggerCommentId?: number | null },
) {
  const { triggerCommentId, ...metadata } = input;
  const reviews = [
    db.createQueuedPRReview(metadata),
    ...db.listReviewLenses(input.repo).filter((lens) => lens.enabled).map((lens) =>
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
        },
        { detached: true },
      );
    } catch (error) {
      db.failPRReview(review.id, `Failed to dispatch review: ${String(error)}`);
    }
  }));
  return reviews;
}
