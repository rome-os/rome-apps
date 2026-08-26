CREATE TABLE `summary__reports` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`period_label` text NOT NULL,
	`window_hours` integer NOT NULL,
	`report` text NOT NULL,
	`raw_sources` text NOT NULL,
	`sources_collected` integer NOT NULL,
	`wechat_sent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
