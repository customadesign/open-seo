CREATE TABLE "audit_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"start_url" text NOT NULL,
	"max_pages" integer DEFAULT 50 NOT NULL,
	"lighthouse_strategy" text DEFAULT 'auto' NOT NULL,
	"schedule_interval" text DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_run_at" text,
	"last_run_audit_id" text,
	"next_run_at" text,
	"last_skip_reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_tracking_configs" ADD COLUMN "max_cost_credits" integer;--> statement-breakpoint
ALTER TABLE "audit_schedules" ADD CONSTRAINT "audit_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_schedules_project_id_idx" ON "audit_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_schedules_due_idx" ON "audit_schedules" USING btree ("is_active","next_run_at");