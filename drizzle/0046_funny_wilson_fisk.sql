CREATE TABLE IF NOT EXISTS `citation_audit_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`observations_total` integer DEFAULT 0 NOT NULL,
	`confirmed_matches` integer DEFAULT 0 NOT NULL,
	`confirmed_mismatches` integer DEFAULT 0 NOT NULL,
	`found_unverified` integer DEFAULT 0 NOT NULL,
	`not_found` integer DEFAULT 0 NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `local_business_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `citation_audit_runs_project_started_idx` ON `citation_audit_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `citation_audit_runs_profile_started_idx` ON `citation_audit_runs` (`profile_id`,`started_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `citation_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_run_id` text NOT NULL,
	`directory_key` text NOT NULL,
	`source_url` text,
	`status` text NOT NULL,
	`observed_name` text,
	`observed_address` text,
	`observed_phone` text,
	`observed_website_url` text,
	`name_matches` integer,
	`address_matches` integer,
	`phone_matches` integer,
	`website_matches` integer,
	`evidence_note` text,
	`error_code` text,
	`checked_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`audit_run_id`) REFERENCES `citation_audit_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `citation_observations_run_status_idx` ON `citation_observations` (`audit_run_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `citation_observations_run_directory_url_idx` ON `citation_observations` (`audit_run_id`,`directory_key`,`source_url`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `geo_grid_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`column_index` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`position` integer,
	`matched_by` text DEFAULT 'none' NOT NULL,
	`result_title` text,
	`result_url` text,
	`provider_result_id` text,
	`checked_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `geo_grid_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `geo_grid_cells_run_coordinate_idx` ON `geo_grid_cells` (`run_id`,`row_index`,`column_index`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `geo_grid_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`keyword` text NOT NULL,
	`center_latitude` real NOT NULL,
	`center_longitude` real NOT NULL,
	`grid_size` integer DEFAULT 5 NOT NULL,
	`radius_meters` integer DEFAULT 5000 NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`device` text DEFAULT 'mobile' NOT NULL,
	`schedule_interval` text DEFAULT 'manual' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `local_business_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `geo_grid_configs_profile_keyword_idx` ON `geo_grid_configs` (`profile_id`,`keyword`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `geo_grid_configs_project_due_idx` ON `geo_grid_configs` (`project_id`,`is_active`,`next_run_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `geo_grid_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_token` text DEFAULT '' NOT NULL,
	`attempt_started_at` text DEFAULT '' NOT NULL,
	`grid_size` integer NOT NULL,
	`radius_meters` integer NOT NULL,
	`cells_total` integer NOT NULL,
	`cells_completed` integer DEFAULT 0 NOT NULL,
	`average_rank` real,
	`top_three_coverage` real,
	`top_ten_coverage` real,
	`top_twenty_coverage` real,
	`cost_usd` real,
	`error_message` text,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`config_id`) REFERENCES `geo_grid_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `geo_grid_runs_one_active_per_config_idx` ON `geo_grid_runs` (`config_id`) WHERE "geo_grid_runs"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `geo_grid_runs_config_started_idx` ON `geo_grid_runs` (`config_id`,`started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `geo_grid_runs_project_started_idx` ON `geo_grid_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `local_business_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`address_line_1` text NOT NULL,
	`address_line_2` text,
	`locality` text NOT NULL,
	`region` text NOT NULL,
	`postal_code` text NOT NULL,
	`country_code` text NOT NULL,
	`phone` text NOT NULL,
	`website_url` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`google_place_id` text,
	`google_cid` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `local_business_profiles_project_idx` ON `local_business_profiles` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `local_business_profiles_one_primary_per_project_idx` ON `local_business_profiles` (`project_id`) WHERE "local_business_profiles"."is_primary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `local_business_profiles_project_place_idx` ON `local_business_profiles` (`project_id`,`google_place_id`) WHERE "local_business_profiles"."google_place_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `local_listing_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`provider` text DEFAULT 'ghl_listings' NOT NULL,
	`ghl_location_id` text NOT NULL,
	`engine` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'setup_required' NOT NULL,
	`status_source` text DEFAULT 'manual' NOT NULL,
	`management_url` text NOT NULL,
	`last_verified_at` text,
	`last_error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `local_business_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `local_listing_connections_profile_provider_idx` ON `local_listing_connections` (`profile_id`,`provider`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `local_listing_connections_ghl_location_idx` ON `local_listing_connections` (`ghl_location_id`);
