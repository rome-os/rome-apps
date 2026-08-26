CREATE TABLE `stock_daily__reports` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text,
	`status` text NOT NULL,
	`trigger_type` text NOT NULL,
	`report_date` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`content` text,
	`sources_json` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_daily__schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`tzid` text NOT NULL,
	`local_time` text NOT NULL,
	`frequency` text NOT NULL,
	`weekday` text,
	`rrule` text NOT NULL,
	`event_name` text,
	`event_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deactivated_at` integer
);
