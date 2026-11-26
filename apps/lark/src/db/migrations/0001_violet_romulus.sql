CREATE TABLE `lark__invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`command` text NOT NULL,
	`identity` text NOT NULL,
	`risk` text NOT NULL,
	`state` text NOT NULL,
	`error_code` text,
	`execution_id` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `lark__settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand` text DEFAULT 'feishu' NOT NULL,
	`agent_enabled` integer DEFAULT true NOT NULL,
	`writes_enabled` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lark__setup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
DROP TABLE `lark__greetings`;