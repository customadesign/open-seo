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
CREATE INDEX `backlink_toxicity_domains_project_class_idx` ON `backlink_toxicity_domains` (`project_id`,`classification`);