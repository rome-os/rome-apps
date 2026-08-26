ALTER TABLE "repo_guardian__pr_review_settings" ADD COLUMN "trigger_on_create" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "repo_guardian__pr_review_settings" ADD COLUMN "trigger_on_request" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "repo_guardian__pr_review_settings" ADD COLUMN "trigger_on_push" integer NOT NULL DEFAULT 1;
