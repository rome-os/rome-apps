CREATE TABLE `repo_guardian__review_lenses` (
  `id` text PRIMARY KEY NOT NULL,
  `repo` text NOT NULL,
  `name` text NOT NULL,
  `instructions` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `repo_guardian__pr_reviews` ADD COLUMN `lens_id` text;
--> statement-breakpoint
ALTER TABLE `repo_guardian__pr_reviews` ADD COLUMN `lens_name` text;
--> statement-breakpoint
ALTER TABLE `repo_guardian__pr_reviews` ADD COLUMN `lens_instructions` text;
