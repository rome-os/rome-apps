DROP INDEX IF EXISTS `company_research__job_posts__company_external_url_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__job_posts__company_role_fingerprint_unique` ON `company_research__job_posts` (`company_id`, `job_title`, `employment_type`, `department`, `location`);
