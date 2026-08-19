CREATE TABLE "audit_robots" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"found" boolean DEFAULT false NOT NULL,
	"status_code" integer,
	"parse_error" text,
	"has_sitemap_directive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_robots_disallows" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"user_agent" text NOT NULL,
	"path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_sitemaps" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"url" text NOT NULL,
	"found" boolean DEFAULT false NOT NULL,
	"status_code" integer,
	"parse_error" text,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"http_url_count" integer DEFAULT 0 NOT NULL,
	"is_index" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backlink_toxicity_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target" text NOT NULL,
	"scope" text NOT NULL,
	"profile_score" integer NOT NULL,
	"profile_verdict" text NOT NULL,
	"domain_count" integer DEFAULT 0 NOT NULL,
	"backlink_count" integer DEFAULT 0 NOT NULL,
	"toxic_count" integer DEFAULT 0 NOT NULL,
	"potentially_toxic_count" integer DEFAULT 0 NOT NULL,
	"non_toxic_count" integer DEFAULT 0 NOT NULL,
	"toxic_percent" integer DEFAULT 0 NOT NULL,
	"new_domain_count" integer DEFAULT 0 NOT NULL,
	"lost_domain_count" integer DEFAULT 0 NOT NULL,
	"broken_domain_count" integer DEFAULT 0 NOT NULL,
	"new_backlink_count" integer DEFAULT 0 NOT NULL,
	"lost_backlink_count" integer DEFAULT 0 NOT NULL,
	"broken_backlink_count" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backlink_toxicity_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"score" integer NOT NULL,
	"verdict" text NOT NULL,
	"classification" text NOT NULL,
	"backlink_count" integer DEFAULT 0 NOT NULL,
	"broken_backlink_count" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"spam_score" integer,
	"is_new" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"is_broken" boolean DEFAULT false NOT NULL,
	"markers_json" text DEFAULT '[]' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_serp_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tracking_keyword_id" text NOT NULL,
	"device" text NOT NULL,
	"row_kind" text NOT NULL,
	"identity" text NOT NULL,
	"domain" text,
	"url" text,
	"position" integer,
	"feature_owned" boolean
);
--> statement-breakpoint
CREATE TABLE "backlink_gap_links" (
	"id" text PRIMARY KEY NOT NULL,
	"referring_domain_id" text NOT NULL,
	"competitor_domain" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backlink_gap_referring_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"referring_domain" text NOT NULL,
	"rank" integer,
	"first_seen" text,
	"competitor_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backlink_gap_run_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"domain" text NOT NULL,
	"role" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backlink_gap_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"fetched_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"keyword" text NOT NULL,
	"search_volume" integer,
	"keyword_difficulty" integer,
	"intent" text,
	"cpc" real,
	"classification" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"keyword_id" text NOT NULL,
	"domain" text NOT NULL,
	"position" integer
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_run_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"domain" text NOT NULL,
	"role" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"include_subdomains" boolean DEFAULT true NOT NULL,
	"fetched_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_magic_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"keyword_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_magic_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"cluster_id" text,
	"keyword" text NOT NULL,
	"search_volume" integer,
	"cpc" real,
	"competition" real,
	"keyword_difficulty" integer,
	"intent" text,
	"word_count" integer NOT NULL,
	"is_broad" boolean DEFAULT false NOT NULL,
	"is_phrase" boolean DEFAULT false NOT NULL,
	"is_exact" boolean DEFAULT false NOT NULL,
	"is_question" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"metrics_updated_at" text
);
--> statement-breakpoint
CREATE TABLE "keyword_magic_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"seed" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"clickstream" boolean DEFAULT false NOT NULL,
	"max_keywords" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"provider" text NOT NULL,
	"keyword_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_credits" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_magic_serp_features" (
	"keyword_id" text NOT NULL,
	"feature" text NOT NULL,
	CONSTRAINT "keyword_magic_serp_features_keyword_id_feature_pk" PRIMARY KEY("keyword_id","feature")
);
--> statement-breakpoint
CREATE TABLE "log_file_bot_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"verified_requests" integer DEFAULT 0 NOT NULL,
	"unverified_requests" integer DEFAULT 0 NOT NULL,
	"unique_ips_claimed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_file_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"r2_key" text NOT NULL,
	"format" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"lines_parsed" integer DEFAULT 0 NOT NULL,
	"lines_skipped" integer DEFAULT 0 NOT NULL,
	"date_from" text,
	"date_to" text,
	"expires_at" text NOT NULL,
	"error_detail" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "log_path_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"project_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"day" text NOT NULL,
	"path" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"verified_requests" integer DEFAULT 0 NOT NULL,
	"bytes_total" integer DEFAULT 0 NOT NULL,
	"response_time_ms_sum" integer DEFAULT 0 NOT NULL,
	"response_time_samples" integer DEFAULT 0 NOT NULL,
	"status_2xx" integer DEFAULT 0 NOT NULL,
	"status_3xx" integer DEFAULT 0 NOT NULL,
	"status_4xx" integer DEFAULT 0 NOT NULL,
	"status_5xx" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "on_page_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target_page_id" text NOT NULL,
	"target_keyword_id" text,
	"bucket" text NOT NULL,
	"idea_type" text NOT NULL,
	"priority" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"dedupe_key" text NOT NULL,
	"detected_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_seen_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "on_page_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"pages_total" integer DEFAULT 0 NOT NULL,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"serp_fetches" integer DEFAULT 0 NOT NULL,
	"ideas_detected" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "on_page_serp_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"fetched_date" text NOT NULL,
	"results_json" text NOT NULL,
	"fetched_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "on_page_target_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"target_page_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer DEFAULT 2840 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"source" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "on_page_target_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_brand_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"token" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_research_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"page_url" text NOT NULL,
	"organic_traffic" integer,
	"keywords" integer
);
--> statement-breakpoint
CREATE TABLE "domain_research_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"include_subdomains" integer DEFAULT 1 NOT NULL,
	"period_key" text NOT NULL,
	"organic_traffic" integer,
	"organic_keywords" integer,
	"traffic_cost" real,
	"captured_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_serp_feature_months" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"feature_type" text NOT NULL,
	"triggered_count" integer DEFAULT 0 NOT NULL,
	"occupied_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "html_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "has_doctype" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "charset" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "has_meta_refresh" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "frame_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "script_urls_json" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "stylesheet_urls_json" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "inline_script_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "inline_style_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "text_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "external_image_srcs_json" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "content_encoding" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "cache_control" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "content_length" integer;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "serp_pruned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD COLUMN "serp_captured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_robots" ADD CONSTRAINT "audit_robots_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_robots_disallows" ADD CONSTRAINT "audit_robots_disallows_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sitemaps" ADD CONSTRAINT "audit_sitemaps_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_toxicity_audits" ADD CONSTRAINT "backlink_toxicity_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_toxicity_domains" ADD CONSTRAINT "backlink_toxicity_domains_audit_id_backlink_toxicity_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."backlink_toxicity_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_toxicity_domains" ADD CONSTRAINT "backlink_toxicity_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_serp_entries" ADD CONSTRAINT "rank_serp_entries_run_id_rank_check_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."rank_check_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_links" ADD CONSTRAINT "backlink_gap_links_referring_domain_id_backlink_gap_referring_domains_id_fk" FOREIGN KEY ("referring_domain_id") REFERENCES "public"."backlink_gap_referring_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_referring_domains" ADD CONSTRAINT "backlink_gap_referring_domains_run_id_backlink_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backlink_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_run_domains" ADD CONSTRAINT "backlink_gap_run_domains_run_id_backlink_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backlink_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_runs" ADD CONSTRAINT "backlink_gap_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_keywords" ADD CONSTRAINT "keyword_gap_keywords_run_id_keyword_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_positions" ADD CONSTRAINT "keyword_gap_positions_keyword_id_keyword_gap_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword_gap_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_run_domains" ADD CONSTRAINT "keyword_gap_run_domains_run_id_keyword_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_runs" ADD CONSTRAINT "keyword_gap_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_clusters" ADD CONSTRAINT "keyword_magic_clusters_run_id_keyword_magic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_magic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_keywords" ADD CONSTRAINT "keyword_magic_keywords_run_id_keyword_magic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_magic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_keywords" ADD CONSTRAINT "keyword_magic_keywords_cluster_id_keyword_magic_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."keyword_magic_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_runs" ADD CONSTRAINT "keyword_magic_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_serp_features" ADD CONSTRAINT "keyword_magic_serp_features_keyword_id_keyword_magic_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword_magic_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_file_bot_summaries" ADD CONSTRAINT "log_file_bot_summaries_upload_id_log_file_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."log_file_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_file_uploads" ADD CONSTRAINT "log_file_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_file_uploads" ADD CONSTRAINT "log_file_uploads_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_path_daily" ADD CONSTRAINT "log_path_daily_upload_id_log_file_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."log_file_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_path_daily" ADD CONSTRAINT "log_path_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_page_ideas" ADD CONSTRAINT "on_page_ideas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_page_ideas" ADD CONSTRAINT "on_page_ideas_target_page_id_on_page_target_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."on_page_target_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_page_ideas" ADD CONSTRAINT "on_page_ideas_target_keyword_id_on_page_target_keywords_id_fk" FOREIGN KEY ("target_keyword_id") REFERENCES "public"."on_page_target_keywords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_page_runs" ADD CONSTRAINT "on_page_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_page_target_keywords" ADD CONSTRAINT "on_page_target_keywords_target_page_id_on_page_target_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."on_page_target_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_page_target_pages" ADD CONSTRAINT "on_page_target_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_brand_tokens" ADD CONSTRAINT "domain_brand_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_research_pages" ADD CONSTRAINT "domain_research_pages_snapshot_id_domain_research_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."domain_research_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_research_snapshots" ADD CONSTRAINT "domain_research_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_serp_feature_months" ADD CONSTRAINT "domain_serp_feature_months_snapshot_id_domain_research_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."domain_research_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_robots_audit_id_idx" ON "audit_robots" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_robots_disallows_audit_id_idx" ON "audit_robots_disallows" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_sitemaps_audit_id_idx" ON "audit_sitemaps" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_sitemaps_audit_url_idx" ON "audit_sitemaps" USING btree ("audit_id","url");--> statement-breakpoint
CREATE INDEX "backlink_toxicity_audits_project_created_idx" ON "backlink_toxicity_audits" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_toxicity_domains_audit_domain_idx" ON "backlink_toxicity_domains" USING btree ("audit_id","domain");--> statement-breakpoint
CREATE INDEX "backlink_toxicity_domains_project_class_idx" ON "backlink_toxicity_domains" USING btree ("project_id","classification");--> statement-breakpoint
CREATE UNIQUE INDEX "rank_serp_entries_run_kw_device_kind_identity_idx" ON "rank_serp_entries" USING btree ("run_id","tracking_keyword_id","device","row_kind","identity");--> statement-breakpoint
CREATE INDEX "rank_serp_entries_run_kind_device_idx" ON "rank_serp_entries" USING btree ("run_id","row_kind","device");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_gap_links_ref_competitor_idx" ON "backlink_gap_links" USING btree ("referring_domain_id","competitor_domain");--> statement-breakpoint
CREATE INDEX "backlink_gap_links_referring_idx" ON "backlink_gap_links" USING btree ("referring_domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_gap_referring_domains_run_domain_idx" ON "backlink_gap_referring_domains" USING btree ("run_id","referring_domain");--> statement-breakpoint
CREATE INDEX "backlink_gap_referring_domains_run_rank_idx" ON "backlink_gap_referring_domains" USING btree ("run_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_gap_run_domains_run_domain_idx" ON "backlink_gap_run_domains" USING btree ("run_id","domain");--> statement-breakpoint
CREATE INDEX "backlink_gap_run_domains_run_sort_idx" ON "backlink_gap_run_domains" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_gap_runs_project_fingerprint_idx" ON "backlink_gap_runs" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "backlink_gap_runs_project_fetched_idx" ON "backlink_gap_runs" USING btree ("project_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_gap_keywords_run_keyword_idx" ON "keyword_gap_keywords" USING btree ("run_id","keyword");--> statement-breakpoint
CREATE INDEX "keyword_gap_keywords_run_class_idx" ON "keyword_gap_keywords" USING btree ("run_id","classification");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_gap_positions_keyword_domain_idx" ON "keyword_gap_positions" USING btree ("keyword_id","domain");--> statement-breakpoint
CREATE INDEX "keyword_gap_positions_keyword_idx" ON "keyword_gap_positions" USING btree ("keyword_id");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_gap_run_domains_run_domain_idx" ON "keyword_gap_run_domains" USING btree ("run_id","domain");--> statement-breakpoint
CREATE INDEX "keyword_gap_run_domains_run_sort_idx" ON "keyword_gap_run_domains" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_gap_runs_project_fingerprint_idx" ON "keyword_gap_runs" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "keyword_gap_runs_project_fetched_idx" ON "keyword_gap_runs" USING btree ("project_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_magic_clusters_run_name_idx" ON "keyword_magic_clusters" USING btree ("run_id","name");--> statement-breakpoint
CREATE INDEX "keyword_magic_clusters_run_sort_idx" ON "keyword_magic_clusters" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_magic_keywords_run_keyword_idx" ON "keyword_magic_keywords" USING btree ("run_id","keyword");--> statement-breakpoint
CREATE INDEX "keyword_magic_keywords_run_cluster_idx" ON "keyword_magic_keywords" USING btree ("run_id","cluster_id");--> statement-breakpoint
CREATE INDEX "keyword_magic_keywords_run_volume_idx" ON "keyword_magic_keywords" USING btree ("run_id","search_volume");--> statement-breakpoint
CREATE INDEX "keyword_magic_keywords_run_word_count_idx" ON "keyword_magic_keywords" USING btree ("run_id","word_count");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_magic_runs_project_fingerprint_idx" ON "keyword_magic_runs" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "keyword_magic_runs_project_created_idx" ON "keyword_magic_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "keyword_magic_serp_features_feature_idx" ON "keyword_magic_serp_features" USING btree ("feature");--> statement-breakpoint
CREATE UNIQUE INDEX "log_file_bot_summaries_upload_bot_idx" ON "log_file_bot_summaries" USING btree ("upload_id","bot_id");--> statement-breakpoint
CREATE INDEX "log_file_uploads_project_id_idx" ON "log_file_uploads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "log_file_uploads_project_created_idx" ON "log_file_uploads" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "log_path_daily_upload_bot_day_path_idx" ON "log_path_daily" USING btree ("upload_id","bot_id","day","path");--> statement-breakpoint
CREATE INDEX "log_path_daily_project_bot_day_idx" ON "log_path_daily" USING btree ("project_id","bot_id","day");--> statement-breakpoint
CREATE INDEX "log_path_daily_upload_id_idx" ON "log_path_daily" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "on_page_ideas_project_dedupe_idx" ON "on_page_ideas" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "on_page_ideas_project_bucket_idx" ON "on_page_ideas" USING btree ("project_id","bucket");--> statement-breakpoint
CREATE INDEX "on_page_ideas_page_idx" ON "on_page_ideas" USING btree ("target_page_id");--> statement-breakpoint
CREATE INDEX "on_page_runs_project_started_idx" ON "on_page_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "on_page_serp_cache_lookup_idx" ON "on_page_serp_cache" USING btree ("keyword","location_code","language_code","fetched_date");--> statement-breakpoint
CREATE UNIQUE INDEX "on_page_target_keywords_page_keyword_idx" ON "on_page_target_keywords" USING btree ("target_page_id","keyword","location_code","language_code");--> statement-breakpoint
CREATE INDEX "on_page_target_keywords_page_idx" ON "on_page_target_keywords" USING btree ("target_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "on_page_target_pages_project_url_idx" ON "on_page_target_pages" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "on_page_target_pages_project_idx" ON "on_page_target_pages" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_brand_tokens_project_domain_token_idx" ON "domain_brand_tokens" USING btree ("project_id","domain","token");--> statement-breakpoint
CREATE INDEX "domain_brand_tokens_project_domain_idx" ON "domain_brand_tokens" USING btree ("project_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_research_pages_snapshot_url_idx" ON "domain_research_pages" USING btree ("snapshot_id","page_url");--> statement-breakpoint
CREATE INDEX "domain_research_pages_snapshot_idx" ON "domain_research_pages" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_research_snapshots_unique_idx" ON "domain_research_snapshots" USING btree ("project_id","domain","location_code","language_code","include_subdomains","period_key");--> statement-breakpoint
CREATE INDEX "domain_research_snapshots_project_captured_idx" ON "domain_research_snapshots" USING btree ("project_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_serp_feature_months_snapshot_feature_idx" ON "domain_serp_feature_months" USING btree ("snapshot_id","feature_type");--> statement-breakpoint
CREATE INDEX "domain_serp_feature_months_snapshot_idx" ON "domain_serp_feature_months" USING btree ("snapshot_id");