CREATE TABLE "project_change_event_states" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" text,
	"dismissed_at" text,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_change_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"source_run_id" text,
	"dedupe_key" text NOT NULL,
	"metric_key" text,
	"previous_numeric_value" real,
	"current_numeric_value" real,
	"unit" text,
	"occurred_at" text NOT NULL,
	"detected_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_change_event_states" ADD CONSTRAINT "project_change_event_states_event_id_project_change_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."project_change_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_event_states" ADD CONSTRAINT "project_change_event_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_events" ADD CONSTRAINT "project_change_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_event_states_event_user_idx" ON "project_change_event_states" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "project_change_event_states_user_updated_idx" ON "project_change_event_states" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_events_project_source_dedupe_idx" ON "project_change_events" USING btree ("project_id","source","dedupe_key");--> statement-breakpoint
CREATE INDEX "project_change_events_project_occurred_idx" ON "project_change_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "project_change_events_project_source_occurred_idx" ON "project_change_events" USING btree ("project_id","source","occurred_at");