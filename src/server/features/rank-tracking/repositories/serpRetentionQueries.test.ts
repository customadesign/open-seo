import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { rankCheckRuns, rankSerpEntries, rankSnapshots } from "@/db/schema";
import { RANK_SERP_RETAINED_CHECKS } from "@/shared/rank-serp-retention";

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let testDb: ReturnType<typeof drizzle>;
let pruneExpiredSerpEntries: (
  configId: string,
  now?: Date,
) => Promise<{ prunedRunCount: number }>;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    runBatch: async (
      build: (tx: typeof testDb) => readonly Promise<unknown>[],
    ) => {
      for (const statement of build(testDb)) await statement;
    },
  }));

  await client.executeMultiple(`
    CREATE TABLE rank_tracking_configs (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE rank_check_runs (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      keywords_total INTEGER NOT NULL DEFAULT 0,
      keywords_checked INTEGER NOT NULL DEFAULT 0,
      is_subset_run INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      serp_pruned INTEGER NOT NULL DEFAULT 0
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
      serp_captured INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE rank_serp_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      tracking_keyword_id TEXT NOT NULL,
      device TEXT NOT NULL,
      row_kind TEXT NOT NULL,
      identity TEXT NOT NULL,
      domain TEXT,
      url TEXT,
      position INTEGER,
      feature_owned INTEGER
    );
    CREATE UNIQUE INDEX rank_serp_entries_run_kw_device_kind_identity_idx
      ON rank_serp_entries (run_id, tracking_keyword_id, device, row_kind, identity);
  `);

  ({ pruneExpiredSerpEntries } =
    await import("@/server/features/rank-tracking/services/rankSerpRetention"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM rank_serp_entries;
    DELETE FROM rank_snapshots;
    DELETE FROM rank_check_runs;
    DELETE FROM rank_tracking_configs;
  `);
  await client.execute(
    "INSERT INTO rank_tracking_configs (id) VALUES ('cfg_1')",
  );
});

const NOW = new Date("2026-08-18T12:00:00.000Z");

async function seedCapturedRun(id: string, daysAgo: number) {
  const startedAt = new Date(
    NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  await client.execute({
    sql: `INSERT INTO rank_check_runs
      (id, config_id, project_id, status, started_at, completed_at, serp_pruned)
      VALUES (?, 'cfg_1', 'proj_1', 'completed', ?, ?, 0)`,
    args: [id, startedAt, startedAt],
  });
  await client.execute({
    sql: `INSERT INTO rank_snapshots
      (run_id, tracking_keyword_id, keyword, device, position, url, serp_captured, checked_at)
      VALUES (?, 'kw_1', 'sign shop', 'desktop', 3, 'https://example.com/', 1, ?)`,
    args: [id, startedAt],
  });
  await client.execute({
    sql: `INSERT INTO rank_serp_entries
      (run_id, tracking_keyword_id, device, row_kind, identity, url, position)
      VALUES (?, 'kw_1', 'desktop', 'owned', 'https://example.com/', 'https://example.com/', 3)`,
    args: [id],
  });
}

describe("pruneExpiredSerpEntries", () => {
  it("keeps exactly N captured checks and does not delete snapshots or runs", async () => {
    for (let day = 20; day < 35; day += 1) {
      await seedCapturedRun(`run_${day}`, day);
    }

    const result = await pruneExpiredSerpEntries("cfg_1", NOW);

    expect(result.prunedRunCount).toBe(2);
    const entries = await testDb
      .select({ runId: rankSerpEntries.runId })
      .from(rankSerpEntries);
    expect(entries).toHaveLength(RANK_SERP_RETAINED_CHECKS + 1);
    const snapshots = await testDb
      .select({
        runId: rankSnapshots.runId,
        serpCaptured: rankSnapshots.serpCaptured,
      })
      .from(rankSnapshots);
    expect(snapshots).toHaveLength(15);
    const runs = await testDb
      .select({
        id: rankCheckRuns.id,
        serpPruned: rankCheckRuns.serpPruned,
      })
      .from(rankCheckRuns);
    expect(runs).toHaveLength(15);
    const pruned = runs.filter((run) => run.serpPruned);
    expect(pruned.map((run) => run.id).toSorted()).toEqual([
      "run_33",
      "run_34",
    ]);
    expect(
      entries.every((entry) => !pruned.some((run) => run.id === entry.runId)),
    ).toBe(true);
  });

  it("marks a pruned captured check without treating it as never-captured", async () => {
    for (let day = 20; day <= 32; day += 1) {
      await seedCapturedRun(`run_${day}`, day);
    }
    await pruneExpiredSerpEntries("cfg_1", NOW);

    const [run] = await testDb
      .select({
        id: rankCheckRuns.id,
        serpPruned: rankCheckRuns.serpPruned,
      })
      .from(rankCheckRuns)
      .where(eq(rankCheckRuns.id, "run_32"));
    const [snapshot] = await testDb
      .select({
        runId: rankSnapshots.runId,
        serpCaptured: rankSnapshots.serpCaptured,
      })
      .from(rankSnapshots)
      .where(eq(rankSnapshots.runId, "run_32"));
    const leftover = await testDb
      .select({ runId: rankSerpEntries.runId })
      .from(rankSerpEntries)
      .where(eq(rankSerpEntries.runId, "run_32"));

    expect(run?.serpPruned).toBe(true);
    expect(snapshot?.serpCaptured).toBe(true);
    expect(leftover).toHaveLength(0);
  });
});
