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
CREATE TABLE "domain_overview_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"organic_traffic" bigint,
	"organic_keywords" bigint,
	"captured_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_visibility_citations" ADD CONSTRAINT "ai_visibility_citations_observation_id_ai_visibility_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_visibility_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_config_providers" ADD CONSTRAINT "ai_visibility_config_providers_config_id_ai_visibility_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_visibility_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_configs" ADD CONSTRAINT "ai_visibility_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_observations" ADD CONSTRAINT "ai_visibility_observations_run_id_ai_visibility_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_visibility_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_config_id_ai_visibility_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_visibility_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_config_id_ai_visibility_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_visibility_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_overview_snapshots" ADD CONSTRAINT "domain_overview_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "domain_overview_snapshots_project_captured_idx" ON "domain_overview_snapshots" USING btree ("project_id","captured_at");