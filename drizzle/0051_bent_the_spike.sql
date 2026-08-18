CREATE TABLE `backlink_gap_links` (
	`id` text PRIMARY KEY NOT NULL,
	`referring_domain_id` text NOT NULL,
	`competitor_domain` text NOT NULL,
	FOREIGN KEY (`referring_domain_id`) REFERENCES `backlink_gap_referring_domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlink_gap_links_ref_competitor_idx` ON `backlink_gap_links` (`referring_domain_id`,`competitor_domain`);--> statement-breakpoint
CREATE INDEX `backlink_gap_links_referring_idx` ON `backlink_gap_links` (`referring_domain_id`);--> statement-breakpoint
CREATE TABLE `backlink_gap_referring_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`referring_domain` text NOT NULL,
	`rank` integer,
	`first_seen` text,
	`competitor_count` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `backlink_gap_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlink_gap_referring_domains_run_domain_idx` ON `backlink_gap_referring_domains` (`run_id`,`referring_domain`);--> statement-breakpoint
CREATE INDEX `backlink_gap_referring_domains_run_rank_idx` ON `backlink_gap_referring_domains` (`run_id`,`rank`);--> statement-breakpoint
CREATE TABLE `backlink_gap_run_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`domain` text NOT NULL,
	`role` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `backlink_gap_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlink_gap_run_domains_run_domain_idx` ON `backlink_gap_run_domains` (`run_id`,`domain`);--> statement-breakpoint
CREATE INDEX `backlink_gap_run_domains_run_sort_idx` ON `backlink_gap_run_domains` (`run_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `backlink_gap_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`fetched_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlink_gap_runs_project_fingerprint_idx` ON `backlink_gap_runs` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `backlink_gap_runs_project_fetched_idx` ON `backlink_gap_runs` (`project_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `keyword_gap_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`keyword` text NOT NULL,
	`search_volume` integer,
	`keyword_difficulty` integer,
	`intent` text,
	`cpc` real,
	`classification` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `keyword_gap_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_gap_keywords_run_keyword_idx` ON `keyword_gap_keywords` (`run_id`,`keyword`);--> statement-breakpoint
CREATE INDEX `keyword_gap_keywords_run_class_idx` ON `keyword_gap_keywords` (`run_id`,`classification`);--> statement-breakpoint
CREATE TABLE `keyword_gap_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL,
	`domain` text NOT NULL,
	`position` integer,
	FOREIGN KEY (`keyword_id`) REFERENCES `keyword_gap_keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_gap_positions_keyword_domain_idx` ON `keyword_gap_positions` (`keyword_id`,`domain`);--> statement-breakpoint
CREATE INDEX `keyword_gap_positions_keyword_idx` ON `keyword_gap_positions` (`keyword_id`);--> statement-breakpoint
CREATE TABLE `keyword_gap_run_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`domain` text NOT NULL,
	`role` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `keyword_gap_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_gap_run_domains_run_domain_idx` ON `keyword_gap_run_domains` (`run_id`,`domain`);--> statement-breakpoint
CREATE INDEX `keyword_gap_run_domains_run_sort_idx` ON `keyword_gap_run_domains` (`run_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `keyword_gap_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`include_subdomains` integer DEFAULT true NOT NULL,
	`fetched_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_gap_runs_project_fingerprint_idx` ON `keyword_gap_runs` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `keyword_gap_runs_project_fetched_idx` ON `keyword_gap_runs` (`project_id`,`fetched_at`);