CREATE TABLE `tikhub__cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tikhub__calls` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`source` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`tag` text,
	`platform` text,
	`status` text NOT NULL,
	`http_status` integer,
	`duration_ms` integer,
	`attempts` integer,
	`request_json` text,
	`request_id` text,
	`cost_usd` real,
	`error_message` text,
	`response_preview` text,
	`response_bytes` integer
);
--> statement-breakpoint
CREATE INDEX `tikhub__calls_created_idx` ON `tikhub__calls` (`created_at`);--> statement-breakpoint
CREATE TABLE `tikhub__settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
