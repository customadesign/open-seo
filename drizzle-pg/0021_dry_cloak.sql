CREATE TABLE "google_ads_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"currency_code" text NOT NULL,
	"time_zone" text NOT NULL,
	"login_customer_id" text,
	"connected_by_user_id" text NOT NULL,
	"google_ads_account_id" text NOT NULL,
	"connected_account_email" text,
	"created_at" text DEFAULT (current_timestamp) NOT NULL,
	"updated_at" text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_commentary_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"evidence_key" text,
	"sort_order" integer NOT NULL,
	"is_generated" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text,
	"created_at" text DEFAULT (current_timestamp) NOT NULL,
	"updated_at" text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"settings_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_key" text,
	"workflow_instance_id" text,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"compare_start" text NOT NULL,
	"compare_end" text NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"snapshot_json" text,
	"error_message" text,
	"created_at" text DEFAULT (current_timestamp) NOT NULL,
	"started_at" text,
	"published_at" text,
	"updated_at" text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"settings_id" text NOT NULL,
	"section_key" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"run_day" integer DEFAULT 4 NOT NULL,
	"run_hour" integer DEFAULT 9 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"created_at" text DEFAULT (current_timestamp) NOT NULL,
	"updated_at" text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_ads_connections" ADD CONSTRAINT "google_ads_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_ads_connections" ADD CONSTRAINT "google_ads_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_commentary_items" ADD CONSTRAINT "report_commentary_items_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_commentary_items" ADD CONSTRAINT "report_commentary_items_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_settings_id_report_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."report_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_settings_id_report_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."report_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_ads_connections_project_idx" ON "google_ads_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "google_ads_connections_organization_idx" ON "google_ads_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "google_ads_connections_connector_idx" ON "google_ads_connections" USING btree ("connected_by_user_id","google_ads_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_commentary_run_kind_order_idx" ON "report_commentary_items" USING btree ("run_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "report_commentary_run_idx" ON "report_commentary_items" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_scheduled_key_idx" ON "report_runs" USING btree ("scheduled_key");--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_workflow_idx" ON "report_runs" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "report_runs_project_created_idx" ON "report_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_project_status_idx" ON "report_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_sections_settings_key_idx" ON "report_sections" USING btree ("settings_id","section_key");--> statement-breakpoint
CREATE UNIQUE INDEX "report_sections_settings_order_idx" ON "report_sections" USING btree ("settings_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "report_settings_project_idx" ON "report_settings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "report_settings_due_idx" ON "report_settings" USING btree ("is_enabled","next_run_at");