CREATE TABLE `diffview__selections` (
  `chat_id` text PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  `state` text
);
--> statement-breakpoint
CREATE TABLE `diffview__cards` (
  `id` text PRIMARY KEY NOT NULL,
  `chat_id` text,
  `payload` text NOT NULL
);
