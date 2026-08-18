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
CREATE INDEX `log_path_daily_upload_id_idx` ON `log_path_daily` (`upload_id`);