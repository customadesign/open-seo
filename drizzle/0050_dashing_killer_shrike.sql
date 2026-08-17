CREATE TABLE `audit_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`start_url` text NOT NULL,
	`max_pages` integer DEFAULT 50 NOT NULL,
	`lighthouse_strategy` text DEFAULT 'auto' NOT NULL,
	`schedule_interval` text DEFAULT 'manual' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`last_run_at` text,
	`last_run_audit_id` text,
	`next_run_at` text,
	`last_skip_reason` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_schedules_project_id_idx` ON `audit_schedules` (`project_id`);--> statement-breakpoint
CREATE INDEX `audit_schedules_due_idx` ON `audit_schedules` (`is_active`,`next_run_at`);--> statement-breakpoint
ALTER TABLE `rank_tracking_configs` ADD `max_cost_credits` integer;