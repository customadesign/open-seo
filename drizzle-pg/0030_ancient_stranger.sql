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
ALTER TABLE "log_file_bot_summaries" ADD CONSTRAINT "log_file_bot_summaries_upload_id_log_file_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."log_file_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_file_uploads" ADD CONSTRAINT "log_file_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_file_uploads" ADD CONSTRAINT "log_file_uploads_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_path_daily" ADD CONSTRAINT "log_path_daily_upload_id_log_file_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."log_file_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_path_daily" ADD CONSTRAINT "log_path_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "log_file_bot_summaries_upload_bot_idx" ON "log_file_bot_summaries" USING btree ("upload_id","bot_id");--> statement-breakpoint
CREATE INDEX "log_file_uploads_project_id_idx" ON "log_file_uploads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "log_file_uploads_project_created_idx" ON "log_file_uploads" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "log_path_daily_upload_bot_day_path_idx" ON "log_path_daily" USING btree ("upload_id","bot_id","day","path");--> statement-breakpoint
CREATE INDEX "log_path_daily_project_bot_day_idx" ON "log_path_daily" USING btree ("project_id","bot_id","day");--> statement-breakpoint
CREATE INDEX "log_path_daily_upload_id_idx" ON "log_path_daily" USING btree ("upload_id");