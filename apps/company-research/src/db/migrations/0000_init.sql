CREATE TABLE IF NOT EXISTS `company_research__entities` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__entities__entity_type_idx` ON `company_research__entities` (`entity_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__entities__display_name_idx` ON `company_research__entities` (`display_name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__companies` (
	`id` text PRIMARY KEY NOT NULL REFERENCES `company_research__entities`(`id`),
	`canonical_name` text NOT NULL,
	`domain` text,
	`website_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__companies__domain_unique` ON `company_research__companies` (`domain`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__companies__website_url_unique` ON `company_research__companies` (`website_url`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__companies__canonical_name_idx` ON `company_research__companies` (`canonical_name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`cadence_months` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__schedules__company_id_unique` ON `company_research__schedules` (`company_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__schedules__is_active_next_run_at_idx` ON `company_research__schedules` (`is_active`, `next_run_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__runs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`status` text NOT NULL,
	`scheduled_for` integer,
	`started_at` integer,
	`completed_at` integer,
	`prompt_version` text,
	`extractor_version` text,
	`report_markdown` text,
	`extractor_output` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__runs__company_id_completed_at_idx` ON `company_research__runs` (`company_id`, `completed_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__runs__status_started_at_idx` ON `company_research__runs` (`status`, `started_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__company_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`common_name` text,
	`founding_date` text,
	`hq_location` text,
	`primary_geographies` text,
	`company_stage` text,
	`business_model_type` text,
	`company_value_proposition` text,
	`industry_tags` text,
	`market_category` text,
	`customer_segments_served` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__company_attributes__company_id_run_id_unique` ON `company_research__company_attributes` (`company_id`, `run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_attributes__company_id_run_id_idx` ON `company_research__company_attributes` (`company_id`, `run_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__company_social_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`platform` text NOT NULL,
	`page_url` text NOT NULL,
	`handle` text,
	`is_official` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__company_social_pages__company_platform_run_unique` ON `company_research__company_social_pages` (`company_id`, `platform`, `run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_social_pages__company_platform_idx` ON `company_research__company_social_pages` (`company_id`, `platform`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__company_social_pages__page_url_unique` ON `company_research__company_social_pages` (`page_url`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__people` (
	`id` text PRIMARY KEY NOT NULL REFERENCES `company_research__entities`(`id`),
	`full_name` text NOT NULL,
	`linkedin_url` text,
	`website_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__people__full_name_idx` ON `company_research__people` (`full_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__people__linkedin_url_unique` ON `company_research__people` (`linkedin_url`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__people__website_url_unique` ON `company_research__people` (`website_url`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__company_person_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`person_id` text NOT NULL REFERENCES `company_research__people`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`role_type` text NOT NULL,
	`title` text,
	`department` text,
	`bio` text,
	`is_current` integer,
	`start_date` text,
	`end_date` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_person_roles__company_role_type_idx` ON `company_research__company_person_roles` (`company_id`, `role_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_person_roles__company_is_current_idx` ON `company_research__company_person_roles` (`company_id`, `is_current`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_person_roles__person_id_idx` ON `company_research__company_person_roles` (`person_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__company_person_roles__natural_key_unique` ON `company_research__company_person_roles` (`company_id`, `person_id`, `role_type`, `title`, `run_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__company_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`related_company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`relationship_type` text NOT NULL,
	`relationship_strength` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_relationships__company_relationship_type_idx` ON `company_research__company_relationships` (`company_id`, `relationship_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__company_relationships__related_company_id_idx` ON `company_research__company_relationships` (`related_company_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__company_relationships__natural_key_unique` ON `company_research__company_relationships` (`company_id`, `related_company_id`, `relationship_type`, `run_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__financing_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`round_type` text NOT NULL,
	`round_label` text,
	`announced_at` text,
	`closed_at` text,
	`amount_raised` integer,
	`amount_raised_currency` text,
	`pre_money_valuation` integer,
	`pre_money_valuation_currency` text,
	`post_money_valuation` integer,
	`post_money_valuation_currency` text,
	`total_capital_raised` integer,
	`total_capital_raised_currency` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__financing_rounds__company_round_date_run_unique` ON `company_research__financing_rounds` (`company_id`, `round_type`, `announced_at`, `run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__financing_rounds__company_announced_at_idx` ON `company_research__financing_rounds` (`company_id`, `announced_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__financing_rounds__company_round_type_idx` ON `company_research__financing_rounds` (`company_id`, `round_type`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__financing_round_investors` (
	`id` text PRIMARY KEY NOT NULL,
	`financing_round_id` text NOT NULL REFERENCES `company_research__financing_rounds`(`id`),
	`entity_id` text NOT NULL REFERENCES `company_research__entities`(`id`),
	`investor_type` text,
	`investor_role` text DEFAULT 'participant' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__financing_round_investors__round_investor_role_unique` ON `company_research__financing_round_investors` (`financing_round_id`, `entity_id`, `investor_role`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__financing_round_investors__round_idx` ON `company_research__financing_round_investors` (`financing_round_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__financing_round_investors__entity_idx` ON `company_research__financing_round_investors` (`entity_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`metric_year` integer NOT NULL,
	`annual_revenue` integer,
	`original_revenue_type` text,
	`original_revenue_value` text,
	`original_revenue_currency` text,
	`profit` integer,
	`original_profit_type` text,
	`original_profit_value` text,
	`original_profit_currency` text,
	`headcount_total` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__metrics__company_metric_year_run_unique` ON `company_research__metrics` (`company_id`, `metric_year`, `run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__metrics__company_metric_year_idx` ON `company_research__metrics` (`company_id`, `metric_year`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__job_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`job_title` text NOT NULL,
	`department` text,
	`location` text,
	`employment_type` text,
	`posted_at` text,
	`external_url` text,
	`description` text,
	`status` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__job_posts__company_posted_at_idx` ON `company_research__job_posts` (`company_id`, `posted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__job_posts__company_status_idx` ON `company_research__job_posts` (`company_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__job_posts__company_role_fingerprint_unique` ON `company_research__job_posts` (`company_id`, `job_title`, `employment_type`, `department`, `location`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__notable_events` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`event_category` text NOT NULL,
	`headline` text NOT NULL,
	`summary` text,
	`event_date` text,
	`external_url` text,
	`source_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__notable_events__company_category_event_date_idx` ON `company_research__notable_events` (`company_id`, `event_category`, `event_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__notable_events__company_category_external_url_unique` ON `company_research__notable_events` (`company_id`, `event_category`, `external_url`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__products` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL REFERENCES `company_research__companies`(`id`),
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`product_name` text NOT NULL,
	`product_category` text,
	`value_proposition` text,
	`target_customer_icp` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__products__company_is_primary_idx` ON `company_research__products` (`company_id`, `is_primary`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__products__company_product_name_idx` ON `company_research__products` (`company_id`, `product_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__products__company_product_run_unique` ON `company_research__products` (`company_id`, `product_name`, `run_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_research__field_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL REFERENCES `company_research__runs`(`id`),
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`field_name` text,
	`as_of_date` text,
	`citation_url` text,
	`confidence` text,
	`reporting_basis` text,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__field_provenance__table_row_idx` ON `company_research__field_provenance` (`table_name`, `row_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__field_provenance__run_id_idx` ON `company_research__field_provenance` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `company_research__field_provenance__table_field_idx` ON `company_research__field_provenance` (`table_name`, `field_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_research__field_provenance__natural_key_unique` ON `company_research__field_provenance` (`table_name`, `row_id`, `field_name`, `run_id`);
