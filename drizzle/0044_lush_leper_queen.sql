CREATE TABLE `member_access_profiles` (
	`member_id` text PRIMARY KEY NOT NULL,
	`account_type` text DEFAULT 'employee' NOT NULL,
	`project_scope` text DEFAULT 'all' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `member_access_profiles_status_idx` ON `member_access_profiles` (`status`);--> statement-breakpoint
CREATE TABLE `project_member_access` (
	`member_id` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`member_id`, `project_id`),
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_member_access_project_idx` ON `project_member_access` (`project_id`);--> statement-breakpoint
INSERT INTO `member_access_profiles` (`member_id`)
SELECT `id`
FROM `member`
WHERE ',' || replace(`role`, ' ', '') || ',' NOT LIKE '%,owner,%';--> statement-breakpoint
CREATE UNIQUE INDEX `member_organizationId_userId_uidx` ON `member` (`organization_id`,`user_id`);
