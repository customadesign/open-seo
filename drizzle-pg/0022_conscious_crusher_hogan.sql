-- Historical Local SEO branch artifact, intentionally absent from the current
-- Postgres journal. The combined forward lineage applies this column in 0026.
ALTER TABLE "geo_grid_runs" ADD COLUMN "attempt_token" text DEFAULT '' NOT NULL;
