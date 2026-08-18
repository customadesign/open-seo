CREATE TABLE `keyword_magic_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`keyword_count` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `keyword_magic_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_magic_clusters_run_name_idx` ON `keyword_magic_clusters` (`run_id`,`name`);--> statement-breakpoint
CREATE INDEX `keyword_magic_clusters_run_sort_idx` ON `keyword_magic_clusters` (`run_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `keyword_magic_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`cluster_id` text,
	`keyword` text NOT NULL,
	`search_volume` integer,
	`cpc` real,
	`competition` real,
	`keyword_difficulty` integer,
	`intent` text,
	`word_count` integer NOT NULL,
	`is_broad` integer DEFAULT false NOT NULL,
	`is_phrase` integer DEFAULT false NOT NULL,
	`is_exact` integer DEFAULT false NOT NULL,
	`is_question` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`metrics_updated_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `keyword_magic_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `keyword_magic_clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_magic_keywords_run_keyword_idx` ON `keyword_magic_keywords` (`run_id`,`keyword`);--> statement-breakpoint
CREATE INDEX `keyword_magic_keywords_run_cluster_idx` ON `keyword_magic_keywords` (`run_id`,`cluster_id`);--> statement-breakpoint
CREATE INDEX `keyword_magic_keywords_run_volume_idx` ON `keyword_magic_keywords` (`run_id`,`search_volume`);--> statement-breakpoint
CREATE INDEX `keyword_magic_keywords_run_word_count_idx` ON `keyword_magic_keywords` (`run_id`,`word_count`);--> statement-breakpoint
CREATE TABLE `keyword_magic_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`seed` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`clickstream` integer DEFAULT false NOT NULL,
	`max_keywords` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`provider` text NOT NULL,
	`keyword_count` integer DEFAULT 0 NOT NULL,
	`estimated_cost_credits` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_magic_runs_project_fingerprint_idx` ON `keyword_magic_runs` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `keyword_magic_runs_project_created_idx` ON `keyword_magic_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `keyword_magic_serp_features` (
	`keyword_id` text NOT NULL,
	`feature` text NOT NULL,
	PRIMARY KEY(`keyword_id`, `feature`),
	FOREIGN KEY (`keyword_id`) REFERENCES `keyword_magic_keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `keyword_magic_serp_features_feature_idx` ON `keyword_magic_serp_features` (`feature`);