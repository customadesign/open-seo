import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as StoredReportSections from "./storedReportSections";

// Real in-memory SQLite so the "newest completed run at or before the period
// end" predicate and the ranked-cell count run against actual SQL.

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

let client: Client;
let loadAiVisibility: typeof StoredReportSections.loadAiVisibility;
let loadLocalGeoGrid: typeof StoredReportSections.loadLocalGeoGrid;

const range = {
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  compareStart: "2026-06-01",
  compareEnd: "2026-06-30",
};

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));

  await client.executeMultiple(`
    CREATE TABLE ai_visibility_configs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, brand_name TEXT NOT NULL,
      domain TEXT NOT NULL, location_code INTEGER NOT NULL DEFAULT 2840,
      language_code TEXT NOT NULL DEFAULT 'en',
      schedule_interval TEXT NOT NULL DEFAULT 'manual',
      is_active INTEGER NOT NULL DEFAULT 0, max_cost_credits INTEGER,
      last_run_at TEXT, next_run_at TEXT, last_skip_reason TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE ai_visibility_runs (
      id TEXT PRIMARY KEY, config_id TEXT NOT NULL, project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', trigger TEXT NOT NULL DEFAULT 'manual',
      observations_total INTEGER NOT NULL DEFAULT 0,
      observations_completed INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0, max_cost_credits INTEGER,
      error_message TEXT, started_at TEXT NOT NULL DEFAULT '', completed_at TEXT
    );
    CREATE TABLE ai_visibility_observations (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tracking_prompt_id TEXT NOT NULL,
      prompt TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
      outcome TEXT NOT NULL, mention_count INTEGER NOT NULL DEFAULT 0,
      domain_cited INTEGER, model_name TEXT, provider_task_id TEXT,
      evidence_r2_key TEXT, cost_usd REAL NOT NULL DEFAULT 0, error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE local_business_profiles (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      address_line_1 TEXT NOT NULL DEFAULT '', address_line_2 TEXT,
      locality TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '', country_code TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', website_url TEXT NOT NULL DEFAULT '',
      latitude REAL NOT NULL DEFAULT 0, longitude REAL NOT NULL DEFAULT 0,
      google_place_id TEXT, google_cid TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT, created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE geo_grid_configs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      keyword TEXT NOT NULL, center_latitude REAL NOT NULL DEFAULT 0,
      center_longitude REAL NOT NULL DEFAULT 0, grid_size INTEGER NOT NULL DEFAULT 5,
      radius_meters INTEGER NOT NULL DEFAULT 5000,
      language_code TEXT NOT NULL DEFAULT 'en', device TEXT NOT NULL DEFAULT 'mobile',
      schedule_interval TEXT NOT NULL DEFAULT 'manual',
      is_active INTEGER NOT NULL DEFAULT 1, next_run_at TEXT, last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE geo_grid_runs (
      id TEXT PRIMARY KEY, config_id TEXT NOT NULL, project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempt_token TEXT NOT NULL DEFAULT '',
      attempt_started_at TEXT NOT NULL DEFAULT '', grid_size INTEGER NOT NULL,
      radius_meters INTEGER NOT NULL, cells_total INTEGER NOT NULL,
      cells_completed INTEGER NOT NULL DEFAULT 0, average_rank REAL,
      top_three_coverage REAL, top_ten_coverage REAL, top_twenty_coverage REAL,
      cost_usd REAL, error_message TEXT, started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT
    );
    CREATE TABLE geo_grid_cells (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, row_index INTEGER NOT NULL,
      column_index INTEGER NOT NULL, latitude REAL NOT NULL DEFAULT 0,
      longitude REAL NOT NULL DEFAULT 0, position INTEGER,
      matched_by TEXT NOT NULL DEFAULT 'none', result_title TEXT,
      result_url TEXT, provider_result_id TEXT, checked_at TEXT NOT NULL DEFAULT ''
    );
  `);
  ({ loadAiVisibility, loadLocalGeoGrid } =
    await import("./storedReportSections"));
});

afterAll(() => client.close());

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM ai_visibility_configs; DELETE FROM ai_visibility_runs;
    DELETE FROM ai_visibility_observations; DELETE FROM local_business_profiles;
    DELETE FROM geo_grid_configs; DELETE FROM geo_grid_runs; DELETE FROM geo_grid_cells;
  `);
});

async function insertAiConfig() {
  await client.execute({
    sql: "INSERT INTO ai_visibility_configs (id, project_id, brand_name, domain) VALUES (?, ?, ?, ?)",
    args: ["config-1", "project-1", "Acme", "acme.test"],
  });
}

async function insertAiRun(
  id: string,
  status: string,
  completedAt: string | null,
) {
  await client.execute({
    sql: "INSERT INTO ai_visibility_runs (id, config_id, project_id, status, completed_at) VALUES (?, ?, ?, ?, ?)",
    args: [id, "config-1", "project-1", status, completedAt],
  });
}

async function insertObservation(
  runId: string,
  provider: string,
  status: string,
  outcome: string,
  mentionCount = 0,
) {
  await client.execute({
    sql: `INSERT INTO ai_visibility_observations
      (id, run_id, tracking_prompt_id, prompt, provider, status, outcome, mention_count)
      VALUES (?, ?, 'prompt-1', 'who sells widgets', ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), runId, provider, status, outcome, mentionCount],
  });
}

describe("loadAiVisibility", () => {
  it("reads the newest completed run within the period, ignoring later and failed runs", async () => {
    await insertAiConfig();
    await insertAiRun("run-old", "completed", "2026-07-05T00:00:00.000Z");
    await insertAiRun("run-new", "completed", "2026-07-20T00:00:00.000Z");
    await insertAiRun("run-failed", "failed", "2026-07-28T00:00:00.000Z");
    await insertAiRun("run-after", "completed", "2026-08-05T00:00:00.000Z");
    await insertObservation(
      "run-new",
      "gemini",
      "completed",
      "brand_mentioned",
      2,
    );

    const result = await loadAiVisibility("project-1", range);

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded" || result.section.key !== "ai_visibility") {
      throw new Error("expected an ai_visibility section");
    }
    expect(result.section.data.configs[0]).toMatchObject({
      runId: "run-new",
      freshness: { capturedAt: "2026-07-20T00:00:00.000Z", isStale: false },
    });
  });

  it("keeps unavailable observations out of the answered share", async () => {
    await insertAiConfig();
    await insertAiRun("run-1", "completed", "2026-07-20T00:00:00.000Z");
    await insertObservation(
      "run-1",
      "gemini",
      "completed",
      "brand_mentioned",
      3,
    );
    await insertObservation("run-1", "gemini", "completed", "brand_absent");
    await insertObservation("run-1", "chatgpt_search", "failed", "unavailable");

    const result = await loadAiVisibility("project-1", range);
    if (result.status !== "loaded" || result.section.key !== "ai_visibility") {
      throw new Error("expected an ai_visibility section");
    }

    // 1 of 2 answered — the outage is reported beside it, not counted as a
    // brand-absent answer, which would have made this 1/3.
    expect(result.section.data.configs[0]?.summary).toMatchObject({
      answered: 2,
      brandMentioned: 1,
      brandAbsent: 1,
      unavailable: 1,
      mentionTotal: 3,
      answerShare: 0.5,
    });
  });

  it("reports a config whose newest run predates the period as stale rather than current", async () => {
    await insertAiConfig();
    await insertAiRun("run-1", "completed", "2026-05-10T00:00:00.000Z");
    await insertObservation("run-1", "gemini", "completed", "brand_mentioned");

    const result = await loadAiVisibility("project-1", range);
    if (result.status !== "loaded" || result.section.key !== "ai_visibility") {
      throw new Error("expected an ai_visibility section");
    }
    expect(result.section.data.configs[0]?.freshness.isStale).toBe(true);
  });

  it("names a brand with no completed run beside the ones that reported", async () => {
    await insertAiConfig();
    await client.execute({
      sql: "INSERT INTO ai_visibility_configs (id, project_id, brand_name, domain) VALUES (?, ?, ?, ?)",
      args: ["config-2", "project-1", "Beta", "beta.test"],
    });
    await insertAiRun("run-1", "completed", "2026-07-20T00:00:00.000Z");
    await insertObservation("run-1", "gemini", "completed", "brand_absent");

    const result = await loadAiVisibility("project-1", range);
    if (result.status !== "loaded" || result.section.key !== "ai_visibility") {
      throw new Error("expected an ai_visibility section");
    }
    // Beta is reported as having no run, not as a brand that scored zero.
    expect(result.section.data.configs).toHaveLength(1);
    expect(result.section.data.unavailable).toEqual([
      { configId: "config-2", brandName: "Beta", reason: "no_completed_run" },
    ]);
  });

  it("omits the section rather than rendering it empty when nothing ran", async () => {
    await insertAiConfig();
    await insertAiRun("run-1", "running", null);

    expect(await loadAiVisibility("project-1", range)).toEqual({
      status: "omitted",
      reason: "no_data",
    });
  });

  it("omits the section when the project tracks no brands", async () => {
    expect(await loadAiVisibility("project-1", range)).toEqual({
      status: "omitted",
      reason: "not_configured",
    });
  });
});

describe("loadLocalGeoGrid", () => {
  async function insertGrid() {
    await client.execute({
      sql: "INSERT INTO local_business_profiles (id, project_id, name) VALUES (?, ?, ?)",
      args: ["profile-1", "project-1", "Acme Plumbing"],
    });
    await client.execute({
      sql: "INSERT INTO geo_grid_configs (id, project_id, profile_id, keyword) VALUES (?, ?, ?, ?)",
      args: ["grid-1", "project-1", "profile-1", "plumber near me"],
    });
  }

  it("counts only grid points that actually returned the business", async () => {
    await insertGrid();
    await client.execute({
      sql: `INSERT INTO geo_grid_runs
        (id, config_id, project_id, status, grid_size, radius_meters, cells_total, cells_completed, average_rank, top_three_coverage, completed_at)
        VALUES ('run-1', 'grid-1', 'project-1', 'completed', 5, 5000, 25, 25, 4.5, 0.4, '2026-07-20T00:00:00.000Z')`,
      args: [],
    });
    for (const [index, position] of [1, 3, null, null, 12].entries()) {
      await client.execute({
        sql: "INSERT INTO geo_grid_cells (id, run_id, row_index, column_index, position) VALUES (?, 'run-1', ?, 0, ?)",
        args: [crypto.randomUUID(), index, position],
      });
    }

    const result = await loadLocalGeoGrid("project-1", range);
    if (result.status !== "loaded" || result.section.key !== "local_geo_grid") {
      throw new Error("expected a local_geo_grid section");
    }
    // Two unranked cells stay unranked; they are not folded in as position 0.
    expect(result.section.data.configs[0]?.summary).toMatchObject({
      cellsCompleted: 25,
      rankedCells: 3,
      averageRank: 4.5,
      topThreeCoverage: 0.4,
    });
  });

  it("omits the section rather than rendering it empty when no grid ran", async () => {
    await insertGrid();

    expect(await loadLocalGeoGrid("project-1", range)).toEqual({
      status: "omitted",
      reason: "no_data",
    });
  });
});
