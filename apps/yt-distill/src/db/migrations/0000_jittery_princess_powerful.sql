CREATE TABLE `yt_distill__distillations` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`video_id` text NOT NULL,
	`title` text,
	`channel` text,
	`lang` text,
	`transcript` text,
	`status` text NOT NULL,
	`error_message` text,
	`requested_types` text NOT NULL,
	`mindmap_md` text,
	`summary_md` text,
	`slides_html` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
