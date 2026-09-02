-- Preserve the existing fail-closed allowlist behavior while adding an
-- opt-in allow-all policy with explicit blocked-account exceptions.
ALTER TABLE `repo_guardian__pr_review_settings` ADD COLUMN `trigger_access_mode` text DEFAULT 'allowlist' NOT NULL;
--> statement-breakpoint
ALTER TABLE `repo_guardian__pr_review_settings` ADD COLUMN `trigger_blocklist` text;
