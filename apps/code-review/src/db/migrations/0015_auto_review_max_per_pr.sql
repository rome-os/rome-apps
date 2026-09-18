-- Cap how many times a single PR can be auto-reviewed. Only successfully
-- completed reviews count toward the cap, and manual triggers (@mention /
-- GitHub review request / dashboard button) are never capped.
ALTER TABLE `repo_guardian__pr_review_settings` ADD COLUMN `auto_review_max_per_pr` integer DEFAULT 5 NOT NULL;
