CREATE TABLE `x__account_state` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text,
	`bio` text,
	`followers` text,
	`following` text,
	`tweets` text,
	`login_status` text DEFAULT 'unknown' NOT NULL,
	`last_checked_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `x__action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`action_name` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`input_json` text,
	`output_json` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `x__brand_voices` (
	`id` text PRIMARY KEY NOT NULL,
	`account_handle` text NOT NULL,
	`is_own` integer DEFAULT 1 NOT NULL,
	`learn_status` text DEFAULT 'idle' NOT NULL,
	`learn_progress` integer DEFAULT 0 NOT NULL,
	`memory_file_path` text,
	`source_accounts` text,
	`tweets_analyzed` integer DEFAULT 0 NOT NULL,
	`last_learned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
