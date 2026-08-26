CREATE TABLE `reddit__agent_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`reddit_post_id` text NOT NULL,
	`title` text NOT NULL,
	`subreddit` text NOT NULL,
	`author` text NOT NULL,
	`score` integer NOT NULL,
	`num_comments` integer NOT NULL,
	`permalink` text NOT NULL,
	`url` text,
	`selftext` text,
	`search_query` text NOT NULL,
	`scan_name` text NOT NULL,
	`created_utc` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`first_scan_run_id` text NOT NULL,
	`last_scan_run_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reddit__agent_posts__reddit_post_id_unique` ON `reddit__agent_posts` (`reddit_post_id`);
--> statement-breakpoint
CREATE INDEX `reddit__agent_posts__scan_name_idx` ON `reddit__agent_posts` (`scan_name`);
--> statement-breakpoint
CREATE INDEX `reddit__agent_posts__subreddit_idx` ON `reddit__agent_posts` (`subreddit`);
--> statement-breakpoint
CREATE INDEX `reddit__agent_posts__last_seen_at_idx` ON `reddit__agent_posts` (`last_seen_at`);
--> statement-breakpoint
CREATE INDEX `reddit__agent_posts__score_idx` ON `reddit__agent_posts` (`score`);
--> statement-breakpoint
CREATE TABLE `reddit__agent_scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_name` text NOT NULL,
	`status` text NOT NULL,
	`query_count` integer NOT NULL,
	`subreddit_count` integer NOT NULL,
	`scanned_pair_count` integer NOT NULL,
	`fetched_count` integer NOT NULL,
	`inserted_count` integer NOT NULL,
	`updated_count` integer NOT NULL,
	`error_count` integer NOT NULL,
	`errors` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `reddit__agent_scan_runs__scan_name_idx` ON `reddit__agent_scan_runs` (`scan_name`);
--> statement-breakpoint
CREATE INDEX `reddit__agent_scan_runs__started_at_idx` ON `reddit__agent_scan_runs` (`started_at`);
