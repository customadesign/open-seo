CREATE TABLE `audit_robots` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`found` integer DEFAULT false NOT NULL,
	`status_code` integer,
	`parse_error` text,
	`has_sitemap_directive` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_robots_audit_id_idx` ON `audit_robots` (`audit_id`);--> statement-breakpoint
CREATE TABLE `audit_robots_disallows` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`user_agent` text NOT NULL,
	`path` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_robots_disallows_audit_id_idx` ON `audit_robots_disallows` (`audit_id`);--> statement-breakpoint
CREATE TABLE `audit_sitemaps` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`url` text NOT NULL,
	`found` integer DEFAULT false NOT NULL,
	`status_code` integer,
	`parse_error` text,
	`entry_count` integer DEFAULT 0 NOT NULL,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`http_url_count` integer DEFAULT 0 NOT NULL,
	`is_index` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_sitemaps_audit_id_idx` ON `audit_sitemaps` (`audit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_sitemaps_audit_url_idx` ON `audit_sitemaps` (`audit_id`,`url`);--> statement-breakpoint
CREATE TABLE `backlink_toxicity_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target` text NOT NULL,
	`scope` text NOT NULL,
	`profile_score` integer NOT NULL,
	`profile_verdict` text NOT NULL,
	`domain_count` integer DEFAULT 0 NOT NULL,
	`backlink_count` integer DEFAULT 0 NOT NULL,
	`toxic_count` integer DEFAULT 0 NOT NULL,
	`potentially_toxic_count` integer DEFAULT 0 NOT NULL,
	`non_toxic_count` integer DEFAULT 0 NOT NULL,
	`toxic_percent` integer DEFAULT 0 NOT NULL,
	`new_domain_count` integer DEFAULT 0 NOT NULL,
	`lost_domain_count` integer DEFAULT 0 NOT NULL,
	`broken_domain_count` integer DEFAULT 0 NOT NULL,
	`new_backlink_count` integer DEFAULT 0 NOT NULL,
	`lost_backlink_count` integer DEFAULT 0 NOT NULL,
	`broken_backlink_count` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backlink_toxicity_audits_project_created_idx` ON `backlink_toxicity_audits` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `backlink_toxicity_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`score` integer NOT NULL,
	`verdict` text NOT NULL,
	`classification` text NOT NULL,
	`backlink_count` integer DEFAULT 0 NOT NULL,
	`broken_backlink_count` integer DEFAULT 0 NOT NULL,
	`rank` integer,
	`spam_score` integer,
	`is_new` integer DEFAULT false NOT NULL,
	`is_lost` integer DEFAULT false NOT NULL,
	`is_broken` integer DEFAULT false NOT NULL,
	`markers_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `backlink_toxicity_audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlink_toxicity_domains_audit_domain_idx` ON `backlink_toxicity_domains` (`audit_id`,`domain`);--> statement-breakpoint
CREATE INDEX `backlink_toxicity_domains_project_class_idx` ON `backlink_toxicity_domains` (`project_id`,`classification`);--> statement-breakpoint
CREATE TABLE `rank_serp_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`tracking_keyword_id` text NOT NULL,
	`device` text NOT NULL,
	`row_kind` text NOT NULL,
	`identity` text NOT NULL,
	`domain` text,
	`url` text,
	`position` integer,
	`feature_owned` integer,
	FOREIGN KEY (`run_id`) REFERENCES `rank_check_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rank_serp_entries_run_kw_device_kind_identity_idx` ON `rank_serp_entries` (`run_id`,`tracking_keyword_id`,`device`,`row_kind`,`identity`);--> statement-breakpoint
CREATE INDEX `rank_serp_entries_run_kind_device_idx` ON `rank_serp_entries` (`run_id`,`row_kind`,`device`);--> statement-breakpoint
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
CREATE INDEX `keyword_gap_runs_project_fetched_idx` ON `keyword_gap_runs` (`project_id`,`fetched_at`);--> statement-breakpoint
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
CREATE INDEX `keyword_magic_serp_features_feature_idx` ON `keyword_magic_serp_features` (`feature`);--> statement-breakpoint
CREATE TABLE `log_file_bot_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`verified_requests` integer DEFAULT 0 NOT NULL,
	`unverified_requests` integer DEFAULT 0 NOT NULL,
	`unique_ips_claimed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `log_file_uploads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `log_file_bot_summaries_upload_bot_idx` ON `log_file_bot_summaries` (`upload_id`,`bot_id`);--> statement-breakpoint
CREATE TABLE `log_file_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`format` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`lines_parsed` integer DEFAULT 0 NOT NULL,
	`lines_skipped` integer DEFAULT 0 NOT NULL,
	`date_from` text,
	`date_to` text,
	`expires_at` text NOT NULL,
	`error_detail` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `log_file_uploads_project_id_idx` ON `log_file_uploads` (`project_id`);--> statement-breakpoint
CREATE INDEX `log_file_uploads_project_created_idx` ON `log_file_uploads` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `log_path_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`project_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`verified_requests` integer DEFAULT 0 NOT NULL,
	`bytes_total` integer DEFAULT 0 NOT NULL,
	`response_time_ms_sum` integer DEFAULT 0 NOT NULL,
	`response_time_samples` integer DEFAULT 0 NOT NULL,
	`status_2xx` integer DEFAULT 0 NOT NULL,
	`status_3xx` integer DEFAULT 0 NOT NULL,
	`status_4xx` integer DEFAULT 0 NOT NULL,
	`status_5xx` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `log_file_uploads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `log_path_daily_upload_bot_day_path_idx` ON `log_path_daily` (`upload_id`,`bot_id`,`day`,`path`);--> statement-breakpoint
CREATE INDEX `log_path_daily_project_bot_day_idx` ON `log_path_daily` (`project_id`,`bot_id`,`day`);--> statement-breakpoint
CREATE INDEX `log_path_daily_upload_id_idx` ON `log_path_daily` (`upload_id`);--> statement-breakpoint
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
CREATE INDEX `on_page_target_pages_project_idx` ON `on_page_target_pages` (`project_id`);--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `html_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `has_doctype` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `charset` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `has_meta_refresh` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `frame_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `script_urls_json` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `stylesheet_urls_json` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `inline_script_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `inline_style_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `text_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `external_image_srcs_json` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `content_encoding` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `cache_control` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `content_type` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `content_length` integer;--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `serp_pruned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rank_snapshots` ADD `serp_captured` integer DEFAULT false NOT NULL;