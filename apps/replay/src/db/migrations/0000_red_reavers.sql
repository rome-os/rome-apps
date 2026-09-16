CREATE TABLE `replay__plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`trace_ids_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replay__sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replay__traces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`block_count` integer NOT NULL,
	`original_user_prompt` text,
	`status` text,
	`model` text,
	`duration_ms` integer,
	`content_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `replay__traces_uploaded_idx` ON `replay__traces` (`uploaded_at`);