CREATE TABLE `discord_digest__configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'discord' NOT NULL,
	`thread_id` text NOT NULL,
	`window_hours` integer DEFAULT 24 NOT NULL,
	`style` text DEFAULT 'friendly' NOT NULL,
	`send_as_bot` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`tzid` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`local_time` text DEFAULT '09:00' NOT NULL,
	`rrule` text DEFAULT 'FREQ=DAILY;INTERVAL=1' NOT NULL,
	`schedule_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_run_at` integer,
	`last_scheduled_at` integer
);
--> statement-breakpoint
CREATE TABLE `discord_digest__runs` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text,
	`channel` text DEFAULT 'discord' NOT NULL,
	`thread_id` text NOT NULL,
	`window_hours` integer NOT NULL,
	`status` text NOT NULL,
	`sent` integer DEFAULT false NOT NULL,
	`summary` text,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
