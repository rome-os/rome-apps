ALTER TABLE `issue_triage__repo_settings` ADD `auto_create_labels` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `issue_triage__repo_settings` ADD `label_map` text;--> statement-breakpoint
ALTER TABLE `issue_triage__repo_settings` ADD `provisioned_at` integer;