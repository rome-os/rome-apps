-- Drop the PR-review "lock" unique index entirely.
--
-- It provided no guarantee the application logic doesn't already give:
-- concurrency dedup is done atomically by claimQueuedPRReview's single-statement
-- NOT EXISTS guard (SQLite serializes writers, so the guarded UPDATE cannot
-- interleave). Its only hard-constraint consumer — tryCreatePRReview's
-- `INSERT OR IGNORE` — is dead code and is removed in this change. All the index
-- did in practice was turn a benign repeat-review into an uncaught UNIQUE error
-- that stranded the row. Replace it with a plain (non-unique) index so the
-- NOT EXISTS commit lookup stays fast.
DROP INDEX IF EXISTS "repo_guardian__pr_reviews_lock_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_guardian__pr_reviews_commit_idx" ON "repo_guardian__pr_reviews" ("repo", "pr_number", "head_sha");
