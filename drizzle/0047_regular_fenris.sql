CREATE TABLE `rank_history_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`config_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_campaign_id` text NOT NULL,
	`search_engine` text NOT NULL,
	`source_location_code` integer,
	`source_location_name` text NOT NULL,
	`source_location_type` text,
	`language_code` text NOT NULL,
	`device` text NOT NULL,
	`continuity` text DEFAULT 'legacy' NOT NULL,
	`first_observed_at` text,
	`last_observed_at` text,
	`imported_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`config_id`) REFERENCES `rank_tracking_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rank_history_sources_provider_campaign_idx` ON `rank_history_sources` (`provider`,`external_campaign_id`);--> statement-breakpoint
CREATE INDEX `rank_history_sources_config_idx` ON `rank_history_sources` (`config_id`,`imported_at`);--> statement-breakpoint
CREATE INDEX `rank_history_sources_project_idx` ON `rank_history_sources` (`project_id`);--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `history_source_id` text REFERENCES rank_history_sources(id);--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `target_location_code` integer;--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `target_location_name` text;--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `target_language_code` text;--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `target_serp_depth` integer;--> statement-breakpoint
UPDATE `rank_check_runs`
SET
	`target_location_code` = (SELECT `location_code` FROM `rank_tracking_configs` WHERE `rank_tracking_configs`.`id` = `rank_check_runs`.`config_id`),
	`target_location_name` = (SELECT `location_name` FROM `rank_tracking_configs` WHERE `rank_tracking_configs`.`id` = `rank_check_runs`.`config_id`),
	`target_language_code` = (SELECT `language_code` FROM `rank_tracking_configs` WHERE `rank_tracking_configs`.`id` = `rank_check_runs`.`config_id`),
	`target_serp_depth` = (SELECT `serp_depth` FROM `rank_tracking_configs` WHERE `rank_tracking_configs`.`id` = `rank_check_runs`.`config_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rank_check_runs_import_source_date_idx` ON `rank_check_runs` (`history_source_id`,`started_at`);
