CREATE TABLE `domain_brand_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_brand_tokens_project_domain_token_idx` ON `domain_brand_tokens` (`project_id`,`domain`,`token`);--> statement-breakpoint
CREATE INDEX `domain_brand_tokens_project_domain_idx` ON `domain_brand_tokens` (`project_id`,`domain`);--> statement-breakpoint
CREATE TABLE `domain_research_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`page_url` text NOT NULL,
	`organic_traffic` integer,
	`keywords` integer,
	FOREIGN KEY (`snapshot_id`) REFERENCES `domain_research_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_research_pages_snapshot_url_idx` ON `domain_research_pages` (`snapshot_id`,`page_url`);--> statement-breakpoint
CREATE INDEX `domain_research_pages_snapshot_idx` ON `domain_research_pages` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `domain_research_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`include_subdomains` integer DEFAULT 1 NOT NULL,
	`period_key` text NOT NULL,
	`organic_traffic` integer,
	`organic_keywords` integer,
	`traffic_cost` real,
	`captured_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_research_snapshots_unique_idx` ON `domain_research_snapshots` (`project_id`,`domain`,`location_code`,`language_code`,`include_subdomains`,`period_key`);--> statement-breakpoint
CREATE INDEX `domain_research_snapshots_project_captured_idx` ON `domain_research_snapshots` (`project_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `domain_serp_feature_months` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`feature_type` text NOT NULL,
	`triggered_count` integer DEFAULT 0 NOT NULL,
	`occupied_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `domain_research_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_serp_feature_months_snapshot_feature_idx` ON `domain_serp_feature_months` (`snapshot_id`,`feature_type`);--> statement-breakpoint
CREATE INDEX `domain_serp_feature_months_snapshot_idx` ON `domain_serp_feature_months` (`snapshot_id`);