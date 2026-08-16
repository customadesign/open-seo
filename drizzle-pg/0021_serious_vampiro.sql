-- Historical Local SEO branch artifact, intentionally absent from the current
-- Postgres journal. The combined forward lineage supersedes it in 0026.
ALTER TABLE "report_templates" ADD COLUMN "deleted_at" text;
