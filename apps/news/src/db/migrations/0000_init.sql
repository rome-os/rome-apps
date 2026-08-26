CREATE TABLE IF NOT EXISTS `news__reddit_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`reddit_post_id` text NOT NULL,
	`title` text NOT NULL,
	`subreddit` text NOT NULL,
	`author` text NOT NULL,
	`score` integer NOT NULL,
	`num_comments` integer NOT NULL,
	`permalink` text NOT NULL,
	`selftext` text,
	`search_query` text NOT NULL,
	`scan_name` text NOT NULL,
	`created_utc` integer NOT NULL,
	`discovered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `news__reddit_posts__reddit_post_id_unique` ON `news__reddit_posts` (`reddit_post_id`);
