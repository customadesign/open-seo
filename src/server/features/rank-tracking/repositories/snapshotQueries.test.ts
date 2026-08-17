import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toSqliteTimestamp } from "@/server/features/rank-tracking/rankTrackingTimestamps";
import type * as SnapshotQueries from "./snapshotQueries";

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let queries: typeof SnapshotQueries;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));

  await client.executeMultiple(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT
    );
    CREATE TABLE rank_tracking_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      location_code INTEGER NOT NULL,
      language_code TEXT NOT NULL,
      devices TEXT NOT NULL,
      serp_depth INTEGER NOT NULL,
      schedule_interval TEXT NOT NULL,
      location_name TEXT,
      is_active INTEGER NOT NULL,
      last_checked_at TEXT,
      next_check_at TEXT,
      last_skip_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE rank_history_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      config_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_campaign_id TEXT NOT NULL,
      search_engine TEXT NOT NULL,
      source_location_code INTEGER,
      source_location_name TEXT NOT NULL,
      source_location_type TEXT,
      language_code TEXT NOT NULL,
      device TEXT NOT NULL,
      continuity TEXT NOT NULL,
      first_observed_at TEXT,
      last_observed_at TEXT,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE rank_check_runs (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      keywords_total INTEGER NOT NULL,
      keywords_checked INTEGER NOT NULL,
      is_subset_run INTEGER NOT NULL,
      history_source_id TEXT,
      target_location_code INTEGER,
      target_location_name TEXT,
      target_language_code TEXT,
      target_serp_depth INTEGER,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE rank_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      tracking_keyword_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      device TEXT NOT NULL,
      position INTEGER,
      url TEXT,
      serp_features TEXT,
      checked_at TEXT NOT NULL
    );

    INSERT INTO projects (id, organization_id, name, domain)
    VALUES ('project', 'org', 'Dallas Signs', 'example.com');
    INSERT INTO rank_tracking_configs
      (id, project_id, domain, location_code, language_code, devices, serp_depth,
       schedule_interval, location_name, is_active, created_at)
    VALUES
      ('config', 'project', 'example.com', 2840, 'en', 'desktop', 100,
       'manual', 'Dallas,Texas,United States', 1, '2025-01-01 00:00:00');

    INSERT INTO rank_history_sources
      (id, project_id, config_id, provider, external_campaign_id, search_engine,
       source_location_code, source_location_name, source_location_type,
       language_code, device, continuity, first_observed_at, last_observed_at,
       imported_at)
    VALUES
      ('source-continuous', 'project', 'config', 'semrush', 'campaign-continuous',
       'google', 1026339, 'Dallas,Texas,United States', 'city', 'en', 'desktop',
       'continuous', '2025-02-01 12:00:00', '2025-03-01 12:00:00',
       '2026-08-17 12:00:00'),
      ('source-legacy', 'project', 'config', 'semrush', 'campaign-legacy',
       'bing', 1026339, 'Dallas,Texas,United States', 'city', 'en', 'desktop',
       'legacy', '2025-04-01 12:00:00', '2025-04-01 12:00:00',
       '2026-08-17 12:00:00'),
      ('source-old-target', 'project', 'config', 'semrush', 'campaign-old-target',
       'google', 1016367, 'Chicago,Illinois,United States', 'city', 'en', 'desktop',
       'continuous', '2025-05-01 12:00:00', '2025-05-01 12:00:00',
       '2026-08-17 12:00:00');
  `);

  await seedRun("native-first", null, "2025-01-01 12:00:00", 10);
  await seedRun(
    "continuous-first",
    "source-continuous",
    "2025-02-01 12:00:00",
    7,
  );
  await seedRun(
    "continuous-last",
    "source-continuous",
    "2025-03-01 12:00:00",
    6,
  );
  await seedRun("legacy", "source-legacy", "2025-04-01 12:00:00", 3);
  await seedRun(
    "old-target",
    "source-old-target",
    "2025-05-01 12:00:00",
    1,
    "Chicago,Illinois,United States",
  );
  await seedRun("native-latest", null, "2025-06-01 12:00:00", 5);

  queries = await import("./snapshotQueries");
});

afterAll(() => {
  client.close();
});

async function seedRun(
  id: string,
  sourceId: string | null,
  checkedAt: string,
  position: number,
  locationName = "Dallas,Texas,United States",
) {
  await client.execute({
    sql: `INSERT INTO rank_check_runs
      (id, config_id, project_id, status, keywords_total, keywords_checked,
       is_subset_run, history_source_id, target_location_code,
       target_location_name, target_language_code, target_serp_depth,
       started_at, completed_at)
      VALUES (?, 'config', 'project', 'completed', 1, 1, 0, ?, 2840, ?, 'en',
              100, ?, ?)`,
    args: [id, sourceId, locationName, checkedAt, checkedAt],
  });
  await client.execute({
    sql: `INSERT INTO rank_snapshots
      (run_id, tracking_keyword_id, keyword, device, position, checked_at)
      VALUES (?, 'keyword', 'sign company', 'desktop', ?, ?)`,
    args: [id, position, checkedAt],
  });
}

describe("rank tracking snapshot queries", () => {
  it("formats comparison cutoffs like SQLite current_timestamp", () => {
    expect(toSqliteTimestamp(new Date("2026-06-09T12:34:56.789Z"))).toBe(
      "2026-06-09 12:34:56",
    );
  });

  it("keeps comparable SEMrush history and excludes legacy or old-target runs", async () => {
    const history = await queries.getKeywordHistory("config", "keyword");

    expect(history.map(({ position }) => position)).toEqual([10, 7, 6, 5]);
    expect(history.map(({ sourceProvider }) => sourceProvider)).toEqual([
      null,
      "semrush",
      "semrush",
      null,
    ]);

    const trend = await queries.getConfigTrend("config", "desktop");
    expect(trend.map(({ runId }) => runId)).toEqual([
      "native-first",
      "continuous-first",
      "continuous-last",
      "native-latest",
    ]);

    const latest = await queries.getLatestSnapshotsForKeywords("config");
    expect(latest).toMatchObject([{ runId: "native-latest", position: 5 }]);

    const earliest = await queries.getEarliestSnapshotsForKeywords("config", [
      "keyword",
    ]);
    expect(earliest).toMatchObject([{ runId: "native-first", position: 10 }]);
  });

  it("reports every imported source separately and measures within-source movement", async () => {
    const sources = await queries.getHistorySourceSummaries("config");
    expect(sources).toHaveLength(3);
    expect(
      sources.map(({ externalCampaignId, continuity, runCount }) => ({
        externalCampaignId,
        continuity,
        runCount,
      })),
    ).toEqual([
      {
        externalCampaignId: "campaign-continuous",
        continuity: "continuous",
        runCount: 2,
      },
      {
        externalCampaignId: "campaign-legacy",
        continuity: "legacy",
        runCount: 1,
      },
      {
        externalCampaignId: "campaign-old-target",
        continuity: "continuous",
        runCount: 1,
      },
    ]);

    expect(
      await queries.getHistorySourceMovement("config", "source-continuous"),
    ).toMatchObject([
      {
        keyword: "sign company",
        firstPosition: 7,
        lastPosition: 6,
        change: 1,
      },
    ]);
  });
});
