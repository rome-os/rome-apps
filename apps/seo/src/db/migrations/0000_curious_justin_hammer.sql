CREATE TABLE `seo__runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`workflow` text,
	`title` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`report` text,
	`session_id` text,
	`execution_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `seo_runs_created_idx` ON `seo__runs` (`created_at`);