CREATE TABLE "member_access_profiles" (
	"member_id" text PRIMARY KEY NOT NULL,
	"account_type" text DEFAULT 'employee' NOT NULL,
	"project_scope" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member_access" (
	"member_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "project_member_access_member_id_project_id_pk" PRIMARY KEY("member_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "member_access_profiles" ADD CONSTRAINT "member_access_profiles_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access_profiles" ADD CONSTRAINT "member_access_profiles_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_access" ADD CONSTRAINT "project_member_access_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_access" ADD CONSTRAINT "project_member_access_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_access_profiles_status_idx" ON "member_access_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_member_access_project_idx" ON "project_member_access" USING btree ("project_id");--> statement-breakpoint
INSERT INTO "member_access_profiles" ("member_id")
SELECT "id"
FROM "member"
WHERE NOT ('owner' = ANY (string_to_array(replace("role", ' ', ''), ',')));--> statement-breakpoint
CREATE UNIQUE INDEX "member_organizationId_userId_uidx" ON "member" USING btree ("organization_id","user_id");
