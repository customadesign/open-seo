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
ALTER TABLE `rank_snapshots` ADD `serp_captured` integer DEFAULT false NOT NULL;