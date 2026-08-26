ALTER TABLE `repo_guardian__pr_review_settings` ADD COLUMN `project_memory` text;
--> statement-breakpoint
CREATE TABLE `repo_guardian__mention_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`surface` text NOT NULL,
	`number` integer NOT NULL,
	`head_sha` text,
	`trigger_comment_id` integer,
	`actor_login` text,
	`intent` text NOT NULL,
	`comment_body` text,
	`status` text NOT NULL DEFAULT 'queued',
	`stage_history` text,
	`result_ref` text,
	`rome_session` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `repo_guardian__memory_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`task_id` text,
	`source` text NOT NULL,
	`source_ref` text,
	`actor` text NOT NULL,
	`before` text,
	`after` text,
	`summary` text,
	`created_at` integer NOT NULL
);
