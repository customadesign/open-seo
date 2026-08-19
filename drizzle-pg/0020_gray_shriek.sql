-- Historical Local SEO branch artifact, intentionally absent from the current
-- Postgres journal. The combined forward lineage applies this schema in 0026.
CREATE TABLE "citation_audit_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"observations_total" integer DEFAULT 0 NOT NULL,
	"confirmed_matches" integer DEFAULT 0 NOT NULL,
	"confirmed_mismatches" integer DEFAULT 0 NOT NULL,
	"found_unverified" integer DEFAULT 0 NOT NULL,
	"not_found" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "citation_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_run_id" text NOT NULL,
	"directory_key" text NOT NULL,
	"source_url" text,
	"status" text NOT NULL,
	"observed_name" text,
	"observed_address" text,
	"observed_phone" text,
	"observed_website_url" text,
	"name_matches" boolean,
	"address_matches" boolean,
	"phone_matches" boolean,
	"website_matches" boolean,
	"evidence_note" text,
	"error_code" text,
	"checked_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_grid_cells" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"column_index" integer NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"position" integer,
	"matched_by" text DEFAULT 'none' NOT NULL,
	"result_title" text,
	"result_url" text,
	"provider_result_id" text,
	"checked_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_grid_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"keyword" text NOT NULL,
	"center_latitude" real NOT NULL,
	"center_longitude" real NOT NULL,
	"grid_size" integer DEFAULT 5 NOT NULL,
	"radius_meters" integer DEFAULT 5000 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"device" text DEFAULT 'mobile' NOT NULL,
	"schedule_interval" text DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_grid_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"grid_size" integer NOT NULL,
	"radius_meters" integer NOT NULL,
	"cells_total" integer NOT NULL,
	"cells_completed" integer DEFAULT 0 NOT NULL,
	"average_rank" real,
	"top_three_coverage" real,
	"top_ten_coverage" real,
	"top_twenty_coverage" real,
	"cost_usd" real,
	"error_message" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "local_business_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"locality" text NOT NULL,
	"region" text NOT NULL,
	"postal_code" text NOT NULL,
	"country_code" text NOT NULL,
	"phone" text NOT NULL,
	"website_url" text NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"google_place_id" text,
	"google_cid" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_listing_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"provider" text DEFAULT 'ghl_listings' NOT NULL,
	"ghl_location_id" text NOT NULL,
	"engine" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'setup_required' NOT NULL,
	"status_source" text DEFAULT 'manual' NOT NULL,
	"management_url" text NOT NULL,
	"last_verified_at" text,
	"last_error" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"checksum_sha256" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"recipient_id" text,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"sent_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"template_id" text NOT NULL,
	"schedule_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"snapshot_json" text,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"last_accessed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "report_share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "report_template_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"section_key" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"brand_name" text,
	"logo_url" text,
	"primary_color" text,
	"accent_color" text,
	"created_by_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citation_audit_runs" ADD CONSTRAINT "citation_audit_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_audit_runs" ADD CONSTRAINT "citation_audit_runs_profile_id_local_business_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."local_business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_observations" ADD CONSTRAINT "citation_observations_audit_run_id_citation_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."citation_audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_grid_cells" ADD CONSTRAINT "geo_grid_cells_run_id_geo_grid_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."geo_grid_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_grid_configs" ADD CONSTRAINT "geo_grid_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_grid_configs" ADD CONSTRAINT "geo_grid_configs_profile_id_local_business_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."local_business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_grid_runs" ADD CONSTRAINT "geo_grid_runs_config_id_geo_grid_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."geo_grid_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_grid_runs" ADD CONSTRAINT "geo_grid_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_business_profiles" ADD CONSTRAINT "local_business_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_listing_connections" ADD CONSTRAINT "local_listing_connections_profile_id_local_business_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."local_business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_recipient_id_report_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."report_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_sections" ADD CONSTRAINT "report_template_sections_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citation_audit_runs_project_started_idx" ON "citation_audit_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "citation_audit_runs_profile_started_idx" ON "citation_audit_runs" USING btree ("profile_id","started_at");--> statement-breakpoint
CREATE INDEX "citation_observations_run_status_idx" ON "citation_observations" USING btree ("audit_run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "citation_observations_run_directory_url_idx" ON "citation_observations" USING btree ("audit_run_id","directory_key","source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "geo_grid_cells_run_coordinate_idx" ON "geo_grid_cells" USING btree ("run_id","row_index","column_index");--> statement-breakpoint
CREATE UNIQUE INDEX "geo_grid_configs_profile_keyword_idx" ON "geo_grid_configs" USING btree ("profile_id","keyword");--> statement-breakpoint
CREATE INDEX "geo_grid_configs_project_due_idx" ON "geo_grid_configs" USING btree ("project_id","is_active","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "geo_grid_runs_one_active_per_config_idx" ON "geo_grid_runs" USING btree ("config_id") WHERE "geo_grid_runs"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "geo_grid_runs_config_started_idx" ON "geo_grid_runs" USING btree ("config_id","started_at");--> statement-breakpoint
CREATE INDEX "geo_grid_runs_project_started_idx" ON "geo_grid_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "local_business_profiles_project_idx" ON "local_business_profiles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_business_profiles_one_primary_per_project_idx" ON "local_business_profiles" USING btree ("project_id") WHERE "local_business_profiles"."is_primary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "local_business_profiles_project_place_idx" ON "local_business_profiles" USING btree ("project_id","google_place_id") WHERE "local_business_profiles"."google_place_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "local_listing_connections_profile_provider_idx" ON "local_listing_connections" USING btree ("profile_id","provider");--> statement-breakpoint
CREATE INDEX "local_listing_connections_ghl_location_idx" ON "local_listing_connections" USING btree ("ghl_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_artifacts_run_kind_idx" ON "report_artifacts" USING btree ("run_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "report_deliveries_run_email_idx" ON "report_deliveries" USING btree ("run_id","email");--> statement-breakpoint
CREATE INDEX "report_deliveries_run_status_idx" ON "report_deliveries" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_recipients_schedule_email_idx" ON "report_recipients" USING btree ("schedule_id","email");--> statement-breakpoint
CREATE INDEX "report_runs_project_started_idx" ON "report_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "report_runs_schedule_started_idx" ON "report_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX "report_schedules_project_due_idx" ON "report_schedules" USING btree ("project_id","is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "report_share_links_run_idx" ON "report_share_links" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_sections_template_key_idx" ON "report_template_sections" USING btree ("template_id","section_key");--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_sections_template_order_idx" ON "report_template_sections" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "report_templates_organization_project_idx" ON "report_templates" USING btree ("organization_id","project_id");
