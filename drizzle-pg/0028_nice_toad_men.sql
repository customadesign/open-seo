CREATE TABLE "monthly_report_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"checksum_sha256" text,
	"expires_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_report_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"profile_id" text,
	"recipient_id" text,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"sent_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_report_delivery_profile_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"section_key" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_report_delivery_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"run_day" integer,
	"run_weekday" integer,
	"run_hour" integer DEFAULT 9 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"brand_name" text,
	"logo_url" text,
	"primary_color" text,
	"accent_color" text,
	"attach_pdf" boolean DEFAULT true NOT NULL,
	"include_share_link" boolean DEFAULT true NOT NULL,
	"share_link_ttl_days" integer DEFAULT 30 NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"created_by_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_report_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_report_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"last_accessed_at" text,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "monthly_report_share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "backlink_disavow_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"entry_type" text NOT NULL,
	"value" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"comments" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"link_count" integer DEFAULT 0 NOT NULL,
	"exported_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "ai_visibility_citations" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"position" integer,
	"is_target_domain" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_config_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"brand_name" text NOT NULL,
	"domain" text NOT NULL,
	"location_code" integer DEFAULT 2840 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"schedule_interval" text DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"max_cost_credits" integer,
	"last_run_at" text,
	"next_run_at" text,
	"last_skip_reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tracking_prompt_id" text NOT NULL,
	"prompt" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"domain_cited" boolean,
	"model_name" text,
	"provider_task_id" text,
	"evidence_r2_key" text,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"error_message" text,
	"checked_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"prompt" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"observations_total" integer DEFAULT 0 NOT NULL,
	"observations_completed" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"max_cost_credits" integer,
	"error_message" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
DROP INDEX "rank_tracking_configs_national_idx";--> statement-breakpoint
DROP INDEX "rank_tracking_configs_local_idx";--> statement-breakpoint
ALTER TABLE "rank_tracking_configs" ADD COLUMN "engine" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_report_runs" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "monthly_report_artifacts" ADD CONSTRAINT "monthly_report_artifacts_run_id_monthly_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monthly_report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_deliveries" ADD CONSTRAINT "monthly_report_deliveries_run_id_monthly_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monthly_report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_deliveries" ADD CONSTRAINT "monthly_report_deliveries_profile_id_monthly_report_delivery_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."monthly_report_delivery_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_deliveries" ADD CONSTRAINT "monthly_report_deliveries_recipient_id_monthly_report_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."monthly_report_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_delivery_profile_sections" ADD CONSTRAINT "monthly_report_delivery_profile_sections_profile_id_monthly_report_delivery_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."monthly_report_delivery_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_delivery_profiles" ADD CONSTRAINT "monthly_report_delivery_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_delivery_profiles" ADD CONSTRAINT "monthly_report_delivery_profiles_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_delivery_profiles" ADD CONSTRAINT "monthly_report_delivery_profiles_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_recipients" ADD CONSTRAINT "monthly_report_recipients_profile_id_monthly_report_delivery_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."monthly_report_delivery_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_share_links" ADD CONSTRAINT "monthly_report_share_links_run_id_monthly_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monthly_report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_share_links" ADD CONSTRAINT "monthly_report_share_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_disavow_entries" ADD CONSTRAINT "backlink_disavow_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_event_states" ADD CONSTRAINT "project_change_event_states_event_id_project_change_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."project_change_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_event_states" ADD CONSTRAINT "project_change_event_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_events" ADD CONSTRAINT "project_change_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_citations" ADD CONSTRAINT "ai_visibility_citations_observation_id_ai_visibility_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_visibility_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_config_providers" ADD CONSTRAINT "ai_visibility_config_providers_config_id_ai_visibility_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_visibility_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_configs" ADD CONSTRAINT "ai_visibility_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_observations" ADD CONSTRAINT "ai_visibility_observations_run_id_ai_visibility_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_visibility_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_config_id_ai_visibility_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_visibility_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_config_id_ai_visibility_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_visibility_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_report_artifacts_run_kind_idx" ON "monthly_report_artifacts" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "monthly_report_artifacts_expires_idx" ON "monthly_report_artifacts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_report_deliveries_run_email_idx" ON "monthly_report_deliveries" USING btree ("run_id","email","is_test");--> statement-breakpoint
CREATE INDEX "monthly_report_deliveries_run_status_idx" ON "monthly_report_deliveries" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "monthly_report_deliveries_status_updated_idx" ON "monthly_report_deliveries" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_report_profile_sections_profile_key_idx" ON "monthly_report_delivery_profile_sections" USING btree ("profile_id","section_key");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_report_profile_sections_profile_order_idx" ON "monthly_report_delivery_profile_sections" USING btree ("profile_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_report_delivery_profiles_project_name_idx" ON "monthly_report_delivery_profiles" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "monthly_report_delivery_profiles_due_idx" ON "monthly_report_delivery_profiles" USING btree ("is_enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_report_recipients_profile_email_idx" ON "monthly_report_recipients" USING btree ("profile_id","email");--> statement-breakpoint
CREATE INDEX "monthly_report_share_links_run_idx" ON "monthly_report_share_links" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "monthly_report_share_links_expires_idx" ON "monthly_report_share_links" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_disavow_entries_project_type_value_idx" ON "backlink_disavow_entries" USING btree ("project_id","entry_type","value");--> statement-breakpoint
CREATE INDEX "backlink_disavow_entries_project_status_idx" ON "backlink_disavow_entries" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_event_states_event_user_idx" ON "project_change_event_states" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "project_change_event_states_user_updated_idx" ON "project_change_event_states" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_events_project_source_dedupe_idx" ON "project_change_events" USING btree ("project_id","source","dedupe_key");--> statement-breakpoint
CREATE INDEX "project_change_events_project_occurred_idx" ON "project_change_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "project_change_events_project_source_occurred_idx" ON "project_change_events" USING btree ("project_id","source","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_citations_observation_url_idx" ON "ai_visibility_citations" USING btree ("observation_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_config_providers_config_provider_idx" ON "ai_visibility_config_providers" USING btree ("config_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_configs_project_brand_location_idx" ON "ai_visibility_configs" USING btree ("project_id","brand_name","location_code");--> statement-breakpoint
CREATE INDEX "ai_visibility_configs_due_idx" ON "ai_visibility_configs" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "ai_visibility_observations_prompt_provider_idx" ON "ai_visibility_observations" USING btree ("tracking_prompt_id","provider","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_observations_run_prompt_provider_idx" ON "ai_visibility_observations" USING btree ("run_id","tracking_prompt_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_prompts_config_prompt_idx" ON "ai_visibility_prompts" USING btree ("config_id","prompt");--> statement-breakpoint
CREATE INDEX "ai_visibility_runs_config_idx" ON "ai_visibility_runs" USING btree ("config_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_visibility_runs_project_idx" ON "ai_visibility_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_runs_one_active_per_config_idx" ON "ai_visibility_runs" USING btree ("config_id") WHERE "ai_visibility_runs"."status" IN ('pending', 'running');--> statement-breakpoint
ALTER TABLE "monthly_report_runs" ADD CONSTRAINT "monthly_report_runs_profile_id_monthly_report_delivery_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."monthly_report_delivery_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_tracking_configs_national_idx" ON "rank_tracking_configs" USING btree ("project_id","domain","engine","location_code") WHERE "rank_tracking_configs"."location_name" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_tracking_configs_local_idx" ON "rank_tracking_configs" USING btree ("project_id","domain","engine","location_code","location_name") WHERE "rank_tracking_configs"."location_name" IS NOT NULL;
--> statement-breakpoint
WITH target_project AS (
  SELECT id
  FROM projects
  WHERE archived_at IS NULL
    AND (
      lower(trim(name)) IN ('uptown locators', 'uptownlocators')
      OR lower(
        rtrim(
          replace(
            replace(
              replace(trim(coalesce(domain, '')), 'https://', ''),
              'http://',
              ''
            ),
            'www.',
            ''
          ),
          '/'
        )
      ) = 'uptownlocators.com'
    )
  ORDER BY
    CASE
      WHEN lower(
        rtrim(
          replace(
            replace(
              replace(trim(coalesce(domain, '')), 'https://', ''),
              'http://',
              ''
            ),
            'www.',
            ''
          ),
          '/'
        )
      ) = 'uptownlocators.com' THEN 0
      ELSE 1
    END,
    created_at,
    id
  LIMIT 1
),
imported_domains(value) AS (
  VALUES
    ('house-rent.info'),
    ('desingtrend.vercel.app'),
    ('p.eurekster.com')
)
INSERT INTO backlink_disavow_entries (
  id,
  project_id,
  entry_type,
  value,
  status,
  comments,
  source,
  link_count,
  exported_at
)
SELECT
  target_project.id || ':disavow:domain:' || imported_domains.value,
  target_project.id,
  'domain',
  imported_domains.value,
  'exported',
  'SEMrush Backlink Audit export (2026-03-23); Google upload not independently confirmed.',
  'semrush_csv',
  0,
  '2026-03-23T00:00:00.000Z'
FROM target_project
CROSS JOIN imported_domains
WHERE true
ON CONFLICT(project_id, entry_type, value) DO NOTHING;
