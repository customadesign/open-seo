CREATE TABLE `google_ads_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`currency_code` text NOT NULL,
	`time_zone` text NOT NULL,
	`login_customer_id` text,
	`connected_by_user_id` text NOT NULL,
	`google_ads_account_id` text NOT NULL,
	`connected_account_email` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_ads_connections_project_idx` ON `google_ads_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `google_ads_connections_organization_idx` ON `google_ads_connections` (`organization_id`);--> statement-breakpoint
CREATE INDEX `google_ads_connections_connector_idx` ON `google_ads_connections` (`connected_by_user_id`,`google_ads_account_id`);--> statement-breakpoint
CREATE TABLE `monthly_report_commentary_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`evidence_key` text,
	`sort_order` integer NOT NULL,
	`is_generated` integer DEFAULT true NOT NULL,
	`updated_by_user_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `monthly_report_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_report_commentary_run_kind_order_idx` ON `monthly_report_commentary_items` (`run_id`,`kind`,`sort_order`);--> statement-breakpoint
CREATE INDEX `monthly_report_commentary_run_idx` ON `monthly_report_commentary_items` (`run_id`);--> statement-breakpoint
CREATE TABLE `monthly_report_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`settings_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scheduled_key` text,
	`workflow_instance_id` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`compare_start` text NOT NULL,
	`compare_end` text NOT NULL,
	`snapshot_version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text,
	`error_message` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`started_at` text,
	`published_at` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settings_id`) REFERENCES `monthly_report_settings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_report_runs_scheduled_key_idx` ON `monthly_report_runs` (`scheduled_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_report_runs_workflow_idx` ON `monthly_report_runs` (`workflow_instance_id`);--> statement-breakpoint
CREATE INDEX `monthly_report_runs_project_created_idx` ON `monthly_report_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `monthly_report_runs_project_status_idx` ON `monthly_report_runs` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `monthly_report_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`settings_id` text NOT NULL,
	`section_key` text NOT NULL,
	`sort_order` integer NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`settings_id`) REFERENCES `monthly_report_settings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_report_sections_settings_key_idx` ON `monthly_report_sections` (`settings_id`,`section_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_report_sections_settings_order_idx` ON `monthly_report_sections` (`settings_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `monthly_report_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`run_day` integer DEFAULT 4 NOT NULL,
	`run_hour` integer DEFAULT 9 NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_report_settings_project_idx` ON `monthly_report_settings` (`project_id`);--> statement-breakpoint
CREATE INDEX `monthly_report_settings_due_idx` ON `monthly_report_settings` (`is_enabled`,`next_run_at`);
