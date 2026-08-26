ALTER TABLE "repo_guardian__pr_reviews" ADD COLUMN "head_sha" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "repo_guardian__pr_reviews_lock_idx" ON "repo_guardian__pr_reviews" ("repo", "pr_number", "head_sha") WHERE "head_sha" IS NOT NULL AND "status" IN ('pending', 'completed');
