UPDATE "google_ads_connections"
SET
  "created_at" = to_char(
    CASE
      WHEN "created_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "created_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "created_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ),
  "updated_at" = to_char(
    CASE
      WHEN "updated_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "updated_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "updated_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
WHERE "created_at" NOT LIKE '%Z' OR "updated_at" NOT LIKE '%Z';
--> statement-breakpoint
UPDATE "monthly_report_settings"
SET
  "created_at" = to_char(
    CASE
      WHEN "created_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "created_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "created_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ),
  "updated_at" = to_char(
    CASE
      WHEN "updated_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "updated_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "updated_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
WHERE "created_at" NOT LIKE '%Z' OR "updated_at" NOT LIKE '%Z';
--> statement-breakpoint
UPDATE "monthly_report_runs"
SET
  "created_at" = to_char(
    CASE
      WHEN "created_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "created_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "created_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ),
  "updated_at" = to_char(
    CASE
      WHEN "updated_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "updated_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "updated_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
WHERE "created_at" NOT LIKE '%Z' OR "updated_at" NOT LIKE '%Z';
--> statement-breakpoint
UPDATE "monthly_report_commentary_items"
SET
  "created_at" = to_char(
    CASE
      WHEN "created_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "created_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "created_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ),
  "updated_at" = to_char(
    CASE
      WHEN "updated_at" ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN "updated_at"::timestamptz AT TIME ZONE 'utc'
      ELSE "updated_at"::timestamp
    END,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
WHERE "created_at" NOT LIKE '%Z' OR "updated_at" NOT LIKE '%Z';
--> statement-breakpoint
ALTER TABLE "google_ads_connections" ALTER COLUMN "created_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "google_ads_connections" ALTER COLUMN "updated_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "monthly_report_commentary_items" ALTER COLUMN "created_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "monthly_report_commentary_items" ALTER COLUMN "updated_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "monthly_report_runs" ALTER COLUMN "created_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "monthly_report_runs" ALTER COLUMN "updated_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "monthly_report_settings" ALTER COLUMN "created_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');--> statement-breakpoint
ALTER TABLE "monthly_report_settings" ALTER COLUMN "updated_at" SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
