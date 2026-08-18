ALTER TABLE "project_change_events" ADD COLUMN "period_start" text;--> statement-breakpoint
ALTER TABLE "project_change_events" ADD COLUMN "period_end" text;--> statement-breakpoint
ALTER TABLE "project_change_events" ADD COLUMN "previous_period_start" text;--> statement-breakpoint
ALTER TABLE "project_change_events" ADD COLUMN "previous_period_end" text;