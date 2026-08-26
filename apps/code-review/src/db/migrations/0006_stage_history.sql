ALTER TABLE "repo_guardian__pr_reviews" ADD COLUMN "stage_history" text;
--> statement-breakpoint
UPDATE "repo_guardian__pr_reviews"
SET "stage_history" = json_array(json_object('stage', "status", 'time', CAST(strftime('%s', COALESCE("completed_at", "started_at")) AS integer) * 1000))
WHERE "stage_history" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "repo_guardian__pr_reviews_lock_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "repo_guardian__pr_reviews_lock_idx" ON "repo_guardian__pr_reviews" ("repo", "pr_number", "head_sha") WHERE "head_sha" IS NOT NULL AND "status" IN ('pending', 'cloning', 'reviewing', 'posting', 'completed');
