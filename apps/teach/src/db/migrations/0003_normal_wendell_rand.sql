CREATE TABLE `teach__module` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `teach__lesson` ADD `module_id` text;