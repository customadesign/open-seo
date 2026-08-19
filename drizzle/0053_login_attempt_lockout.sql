CREATE TABLE `auth_login_attempt` (
	`email` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`lock_level` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_failed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_login_attempt_last_failed_at_idx` ON `auth_login_attempt` (`last_failed_at`);
