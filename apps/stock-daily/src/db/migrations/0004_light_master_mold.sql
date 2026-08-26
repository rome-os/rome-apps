ALTER TABLE `stock_daily__schedules` ADD `send_email` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_daily__schedules` ADD `email_recipient` text;--> statement-breakpoint
UPDATE `stock_daily__schedules` SET `send_email` = `send_wechat`;
