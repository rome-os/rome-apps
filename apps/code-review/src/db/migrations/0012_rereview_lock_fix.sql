-- Fix the PR-review "lock" index so a COMPLETED review no longer permanently
-- locks its commit against a fresh re-review.
--
-- The old partial index included 'completed' in its WHERE clause, so once a
-- commit had been reviewed, a new review of the SAME commit (e.g. a repeat PTAL
-- with no new push) collided on (repo, pr_number, head_sha) the moment
-- claimQueuedPRReview stamped the head_sha. That threw an uncaught
-- UNIQUE-constraint error, killing the detached run and stranding the row at
-- 'fetching_pr_info' forever. The lock is only meant to prevent two
-- concurrently IN-PROGRESS reviews of the same commit, which is exactly the set
-- claimQueuedPRReview's own NOT EXISTS guard already checks. Drop the terminal
-- statuses from the index to align the two.
DROP INDEX IF EXISTS "repo_guardian__pr_reviews_lock_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "repo_guardian__pr_reviews_lock_idx" ON "repo_guardian__pr_reviews" ("repo", "pr_number", "head_sha") WHERE "head_sha" IS NOT NULL AND "status" IN ('pending', 'cloning', 'reviewing', 'posting');
--> statement-breakpoint
-- One-time cleanup: fail every review left stranded in a non-terminal state by
-- the old collision (or by a past process restart). This app reload kills any
-- detached run, so no row matched here can still be alive.
UPDATE "repo_guardian__pr_reviews" SET "status" = 'failed', "completed_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), "review_comment" = COALESCE("review_comment", 'Interrupted — review did not finish and was auto-failed as stale.') WHERE "status" IN ('queued', 'fetching_pr_info', 'pending', 'cloning', 'reviewing', 'posting', 'running');
