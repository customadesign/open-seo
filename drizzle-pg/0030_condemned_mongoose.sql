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
ALTER TABLE "backlink_toxicity_audits" ADD CONSTRAINT "backlink_toxicity_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_toxicity_domains" ADD CONSTRAINT "backlink_toxicity_domains_audit_id_backlink_toxicity_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."backlink_toxicity_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlink_toxicity_domains" ADD CONSTRAINT "backlink_toxicity_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backlink_toxicity_audits_project_created_idx" ON "backlink_toxicity_audits" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_toxicity_domains_audit_domain_idx" ON "backlink_toxicity_domains" USING btree ("audit_id","domain");--> statement-breakpoint
CREATE INDEX "backlink_toxicity_domains_project_class_idx" ON "backlink_toxicity_domains" USING btree ("project_id","classification");