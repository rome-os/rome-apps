CREATE TABLE `survey__accounting` (
	`id` text PRIMARY KEY NOT NULL,
	`survey_id` text NOT NULL,
	`response_id` text,
	`action_type` text NOT NULL,
	`provider` text,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
