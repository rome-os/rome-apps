-- Small app-wide key/value settings (e.g. the remembered public origin used
-- for links back to the dashboard from GitHub review footers).
CREATE TABLE IF NOT EXISTS `repo_guardian__app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
