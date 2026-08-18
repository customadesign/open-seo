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
ALTER TABLE "backlink_gap_links" ADD CONSTRAINT "backlink_gap_links_referring_domain_id_backlink_gap_referring_domains_id_fk" FOREIGN KEY ("referring_domain_id") REFERENCES "public"."backlink_gap_referring_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_referring_domains" ADD CONSTRAINT "backlink_gap_referring_domains_run_id_backlink_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backlink_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_run_domains" ADD CONSTRAINT "backlink_gap_run_domains_run_id_backlink_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backlink_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_gap_runs" ADD CONSTRAINT "backlink_gap_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_keywords" ADD CONSTRAINT "keyword_gap_keywords_run_id_keyword_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_positions" ADD CONSTRAINT "keyword_gap_positions_keyword_id_keyword_gap_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword_gap_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_run_domains" ADD CONSTRAINT "keyword_gap_run_domains_run_id_keyword_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_runs" ADD CONSTRAINT "keyword_gap_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "keyword_gap_runs_project_fetched_idx" ON "keyword_gap_runs" USING btree ("project_id","fetched_at");