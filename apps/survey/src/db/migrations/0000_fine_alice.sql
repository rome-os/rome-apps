CREATE TABLE `survey__design_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`survey_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `survey__response_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`response_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`ui_block` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `survey__survey_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`survey_id` text NOT NULL,
	`respondent_id` text,
	`answers` text,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `survey__surveys` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`description` text,
	`schema_definition` text,
	`form_definition` text,
	`status` text DEFAULT 'designing' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
