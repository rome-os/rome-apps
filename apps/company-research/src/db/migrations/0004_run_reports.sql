ALTER TABLE `company_research__runs` DROP COLUMN `report_markdown`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__reports` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`report_type` text NOT NULL,
	`report_content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__reports__run_report_type_unique` ON `company_research__reports` (`run_id`, `report_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__reports__company_run_idx` ON `company_research__reports` (`company_id`, `run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__reports__report_type_idx` ON `company_research__reports` (`report_type`);
