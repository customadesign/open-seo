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
ALTER TABLE "audit_robots" ADD CONSTRAINT "audit_robots_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_robots_disallows" ADD CONSTRAINT "audit_robots_disallows_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sitemaps" ADD CONSTRAINT "audit_sitemaps_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_robots_audit_id_idx" ON "audit_robots" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_robots_disallows_audit_id_idx" ON "audit_robots_disallows" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_sitemaps_audit_id_idx" ON "audit_sitemaps" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_sitemaps_audit_url_idx" ON "audit_sitemaps" USING btree ("audit_id","url");