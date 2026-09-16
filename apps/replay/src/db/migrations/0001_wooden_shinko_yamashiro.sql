ALTER TABLE `replay__plans` ADD `speed` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `replay__plans` ADD `turn_budget_ms` integer DEFAULT 30000 NOT NULL;