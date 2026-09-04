CREATE TABLE `issue_triage__repo_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`auto_triage_enabled` integer DEFAULT 0 NOT NULL,
	`trigger_on_open` integer DEFAULT 1 NOT NULL,
	`trigger_on_edit` integer DEFAULT 1 NOT NULL,
	`apply_mode` text DEFAULT 'apply' NOT NULL,
	`dimensions_enabled` text,
	`create_missing_labels` integer DEFAULT 1 NOT NULL,
	`custom_rules` text,
	`github_webhook_id` text,
	`webhook_channel_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_triage__repo_settings_repo_unique` ON `issue_triage__repo_settings` (`repo`);--> statement-breakpoint
CREATE TABLE `issue_triage__repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_triage__repositories_slug_unique` ON `issue_triage__repositories` (`slug`);--> statement-breakpoint
CREATE TABLE `issue_triage__triage_results` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`issue_number` integer NOT NULL,
	`issue_url` text,
	`issue_title` text,
	`actor` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`applied_labels` text,
	`created_labels` text,
	`reasoning` text,
	`classification` text,
	`content_sig` text,
	`rome_session` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
