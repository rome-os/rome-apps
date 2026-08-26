CREATE TABLE `repo_guardian__findings` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`file_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_guardian__github_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text,
	`finding_id` text,
	`action_type` text NOT NULL,
	`github_url` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_guardian__scans` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_type` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
