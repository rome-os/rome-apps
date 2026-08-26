CREATE TABLE `repo_guardian__pr_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_url` text NOT NULL,
	`pr_title` text NOT NULL,
	`pr_author` text,
	`status` text NOT NULL DEFAULT 'pending',
	`review_comment` text,
	`github_comment_url` text,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `repo_guardian__pr_review_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL UNIQUE,
	`auto_review_enabled` integer NOT NULL DEFAULT 0,
	`custom_rules` text,
	`webhook_channel_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
