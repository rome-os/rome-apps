CREATE TABLE `settle__events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `settle__events_request_idx` ON `settle__events` (`request_id`);--> statement-breakpoint
CREATE TABLE `settle__payments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`account_id` text NOT NULL,
	`email` text,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'awaiting' NOT NULL,
	`favor_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`settled_at` text
);
--> statement-breakpoint
CREATE INDEX `settle__payments_request_idx` ON `settle__payments` (`request_id`);--> statement-breakpoint
CREATE TABLE `settle__requests` (
	`id` text PRIMARY KEY NOT NULL,
	`item` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`recipient_name` text DEFAULT '' NOT NULL,
	`recipient_email` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`paid_via` text,
	`payer_account_id` text,
	`payer_email` text,
	`payment_id` text,
	`paid_at` text,
	`view_count` integer DEFAULT 0 NOT NULL,
	`first_viewed_at` text,
	`last_viewed_at` text,
	`voided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `settle__requests_status_idx` ON `settle__requests` (`status`);--> statement-breakpoint
CREATE TABLE `settle__settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
