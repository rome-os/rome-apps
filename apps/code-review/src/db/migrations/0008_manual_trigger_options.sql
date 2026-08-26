ALTER TABLE "repo_guardian__pr_review_settings" ADD COLUMN "trigger_on_review_request" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "repo_guardian__pr_review_settings" ADD COLUMN "trigger_on_mention" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "repo_guardian__pr_review_settings" ADD COLUMN "mention_trigger_phrase" text NOT NULL DEFAULT 'PTAL';
