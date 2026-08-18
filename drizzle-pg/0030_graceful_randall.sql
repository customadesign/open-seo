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
ALTER TABLE "keyword_magic_clusters" ADD CONSTRAINT "keyword_magic_clusters_run_id_keyword_magic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_magic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_keywords" ADD CONSTRAINT "keyword_magic_keywords_run_id_keyword_magic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_magic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_keywords" ADD CONSTRAINT "keyword_magic_keywords_cluster_id_keyword_magic_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."keyword_magic_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_runs" ADD CONSTRAINT "keyword_magic_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_magic_serp_features" ADD CONSTRAINT "keyword_magic_serp_features_keyword_id_keyword_magic_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword_magic_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_magic_clusters_run_name_idx" ON "keyword_magic_clusters" USING btree ("run_id","name");--> statement-breakpoint
CREATE INDEX "keyword_magic_clusters_run_sort_idx" ON "keyword_magic_clusters" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_magic_keywords_run_keyword_idx" ON "keyword_magic_keywords" USING btree ("run_id","keyword");--> statement-breakpoint
CREATE INDEX "keyword_magic_keywords_run_cluster_idx" ON "keyword_magic_keywords" USING btree ("run_id","cluster_id");--> statement-breakpoint
CREATE INDEX "keyword_magic_keywords_run_volume_idx" ON "keyword_magic_keywords" USING btree ("run_id","search_volume");--> statement-breakpoint
CREATE INDEX "keyword_magic_keywords_run_word_count_idx" ON "keyword_magic_keywords" USING btree ("run_id","word_count");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_magic_runs_project_fingerprint_idx" ON "keyword_magic_runs" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "keyword_magic_runs_project_created_idx" ON "keyword_magic_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "keyword_magic_serp_features_feature_idx" ON "keyword_magic_serp_features" USING btree ("feature");