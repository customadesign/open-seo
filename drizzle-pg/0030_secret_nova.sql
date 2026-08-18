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
ALTER TABLE "rank_snapshots" ADD COLUMN "serp_captured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_serp_entries" ADD CONSTRAINT "rank_serp_entries_run_id_rank_check_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."rank_check_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_serp_entries_run_kw_device_kind_identity_idx" ON "rank_serp_entries" USING btree ("run_id","tracking_keyword_id","device","row_kind","identity");--> statement-breakpoint
CREATE INDEX "rank_serp_entries_run_kind_device_idx" ON "rank_serp_entries" USING btree ("run_id","row_kind","device");