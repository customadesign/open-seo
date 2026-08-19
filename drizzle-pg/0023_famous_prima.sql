CREATE TABLE "rank_history_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"config_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_campaign_id" text NOT NULL,
	"search_engine" text NOT NULL,
	"source_location_code" integer,
	"source_location_name" text NOT NULL,
	"source_location_type" text,
	"language_code" text NOT NULL,
	"device" text NOT NULL,
	"continuity" text DEFAULT 'legacy' NOT NULL,
	"first_observed_at" text,
	"last_observed_at" text,
	"imported_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "history_source_id" text;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "target_location_code" integer;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "target_location_name" text;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "target_language_code" text;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "target_serp_depth" integer;--> statement-breakpoint
UPDATE "rank_check_runs" AS runs
SET
	"target_location_code" = configs."location_code",
	"target_location_name" = configs."location_name",
	"target_language_code" = configs."language_code",
	"target_serp_depth" = configs."serp_depth"
FROM "rank_tracking_configs" AS configs
WHERE configs."id" = runs."config_id";--> statement-breakpoint
ALTER TABLE "rank_history_sources" ADD CONSTRAINT "rank_history_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history_sources" ADD CONSTRAINT "rank_history_sources_config_id_rank_tracking_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."rank_tracking_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_history_sources_provider_campaign_idx" ON "rank_history_sources" USING btree ("provider","external_campaign_id");--> statement-breakpoint
CREATE INDEX "rank_history_sources_config_idx" ON "rank_history_sources" USING btree ("config_id","imported_at");--> statement-breakpoint
CREATE INDEX "rank_history_sources_project_idx" ON "rank_history_sources" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_history_source_id_rank_history_sources_id_fk" FOREIGN KEY ("history_source_id") REFERENCES "public"."rank_history_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_check_runs_import_source_date_idx" ON "rank_check_runs" USING btree ("history_source_id","started_at");
