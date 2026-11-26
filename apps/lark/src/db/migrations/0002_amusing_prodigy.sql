ALTER TABLE `lark__invocations` ADD `connection_id` text DEFAULT 'local-cli' NOT NULL;--> statement-breakpoint
ALTER TABLE `lark__invocations` ADD `authorization_revision` text;