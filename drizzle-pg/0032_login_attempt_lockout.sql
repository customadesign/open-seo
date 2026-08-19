CREATE TABLE IF NOT EXISTS "auth_login_attempt" (
	"email" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"lock_level" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_login_attempt_last_failed_at_idx" ON "auth_login_attempt" USING btree ("last_failed_at");
