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
ALTER TABLE "domain_brand_tokens" ADD CONSTRAINT "domain_brand_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_research_pages" ADD CONSTRAINT "domain_research_pages_snapshot_id_domain_research_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."domain_research_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_research_snapshots" ADD CONSTRAINT "domain_research_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_serp_feature_months" ADD CONSTRAINT "domain_serp_feature_months_snapshot_id_domain_research_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."domain_research_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_brand_tokens_project_domain_token_idx" ON "domain_brand_tokens" USING btree ("project_id","domain","token");--> statement-breakpoint
CREATE INDEX "domain_brand_tokens_project_domain_idx" ON "domain_brand_tokens" USING btree ("project_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_research_pages_snapshot_url_idx" ON "domain_research_pages" USING btree ("snapshot_id","page_url");--> statement-breakpoint
CREATE INDEX "domain_research_pages_snapshot_idx" ON "domain_research_pages" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_research_snapshots_unique_idx" ON "domain_research_snapshots" USING btree ("project_id","domain","location_code","language_code","include_subdomains","period_key");--> statement-breakpoint
CREATE INDEX "domain_research_snapshots_project_captured_idx" ON "domain_research_snapshots" USING btree ("project_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_serp_feature_months_snapshot_feature_idx" ON "domain_serp_feature_months" USING btree ("snapshot_id","feature_type");--> statement-breakpoint
CREATE INDEX "domain_serp_feature_months_snapshot_idx" ON "domain_serp_feature_months" USING btree ("snapshot_id");