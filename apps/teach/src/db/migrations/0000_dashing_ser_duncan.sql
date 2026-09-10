CREATE TABLE `teach__app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`default_notify_channel` text DEFAULT 'webchat' NOT NULL,
	`daily_review_time` text DEFAULT '09:00' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teach__card` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`lesson_id` text,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`ease` real DEFAULT 2.5 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teach__learning_record` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`lesson_id` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teach__lesson` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`html` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`error_note` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `teach__mission` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`motivation` text DEFAULT '' NOT NULL,
	`target_level` text DEFAULT 'beginner' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`notify_channel` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teach__resource` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text,
	`title` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teach__review` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`grade` integer NOT NULL,
	`prev_interval` integer NOT NULL,
	`new_interval` integer NOT NULL,
	`reviewed_at` integer NOT NULL
);
