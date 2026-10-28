-- NULL means compatibility defaults resolved from the untouched legacy columns.
-- Only the missing controls for the five shipped agents live in this object.
ALTER TABLE `repo_guardian__pr_review_settings` ADD COLUMN `agent_settings` text;
