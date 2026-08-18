CREATE TABLE `on_page_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_page_id` text NOT NULL,
	`target_keyword_id` text,
	`bucket` text NOT NULL,
	`idea_type` text NOT NULL,
	`priority` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`dedupe_key` text NOT NULL,
	`detected_at` text DEFAULT (current_timestamp) NOT NULL,
	`last_seen_at` text DEFAULT (current_timestamp) NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_page_id`) REFERENCES `on_page_target_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_keyword_id`) REFERENCES `on_page_target_keywords`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `on_page_ideas_project_dedupe_idx` ON `on_page_ideas` (`project_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `on_page_ideas_project_bucket_idx` ON `on_page_ideas` (`project_id`,`bucket`);--> statement-breakpoint
CREATE INDEX `on_page_ideas_page_idx` ON `on_page_ideas` (`target_page_id`);--> statement-breakpoint
CREATE TABLE `on_page_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`pages_total` integer DEFAULT 0 NOT NULL,
	`pages_processed` integer DEFAULT 0 NOT NULL,
	`serp_fetches` integer DEFAULT 0 NOT NULL,
	`ideas_detected` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `on_page_runs_project_started_idx` ON `on_page_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `on_page_serp_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`fetched_date` text NOT NULL,
	`results_json` text NOT NULL,
	`fetched_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `on_page_serp_cache_lookup_idx` ON `on_page_serp_cache` (`keyword`,`location_code`,`language_code`,`fetched_date`);--> statement-breakpoint
CREATE TABLE `on_page_target_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`target_page_id` text NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer DEFAULT 2840 NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`target_page_id`) REFERENCES `on_page_target_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `on_page_target_keywords_page_keyword_idx` ON `on_page_target_keywords` (`target_page_id`,`keyword`,`location_code`,`language_code`);--> statement-breakpoint
CREATE INDEX `on_page_target_keywords_page_idx` ON `on_page_target_keywords` (`target_page_id`);--> statement-breakpoint
CREATE TABLE `on_page_target_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `on_page_target_pages_project_url_idx` ON `on_page_target_pages` (`project_id`,`url`);--> statement-breakpoint
CREATE INDEX `on_page_target_pages_project_idx` ON `on_page_target_pages` (`project_id`);