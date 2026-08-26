CREATE TABLE `repo_guardian__repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `repo_guardian__scans` ADD `repo` text NOT NULL DEFAULT '';
