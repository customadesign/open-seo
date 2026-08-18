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
ALTER TABLE `audit_pages` ADD `content_type` text;