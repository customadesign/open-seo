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
import type * as ChangeEventRepositoryModule from "./ChangeEventRepository";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

let client: Client;
let repository: typeof ChangeEventRepositoryModule.ChangeEventRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  await client.executeMultiple(`
    CREATE TABLE project_change_events (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source TEXT NOT NULL,
      event_type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL,
      summary TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
      source_run_id TEXT, dedupe_key TEXT NOT NULL, metric_key TEXT,
      previous_numeric_value REAL, current_numeric_value REAL, unit TEXT,
      occurred_at TEXT NOT NULL, detected_at TEXT NOT NULL,
      UNIQUE(project_id, source, dedupe_key)
    );
    CREATE TABLE project_change_event_states (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
      read_at TEXT, dismissed_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(event_id, user_id)
    );
  `);
  ({ ChangeEventRepository: repository } =
    await import("./ChangeEventRepository"));
});

afterAll(() => client.close());

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM project_change_event_states;
    DELETE FROM project_change_events;
    INSERT INTO project_change_events VALUES
      ('event-1', 'project-a', 'audit', 'audit.regression', 'warning', 'New issues', 'Summary', 'audit', 'audit-1', 'audit-1', 'audit:1', 'issue_count', 1, 2, 'issues', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'),
      ('event-2', 'project-a', 'reports', 'reports.failed', 'warning', 'Report failed', 'Summary', 'report_run', 'run-1', 'run-1', 'report:1', NULL, NULL, NULL, NULL, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z'),
      ('event-b', 'project-b', 'audit', 'audit.regression', 'critical', 'Other project', 'Summary', NULL, NULL, NULL, 'audit:b', NULL, NULL, NULL, NULL, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
    INSERT INTO project_change_event_states VALUES
      ('state-1', 'event-1', 'user-1', '2026-08-17T01:00:00.000Z', NULL, '2026-08-17T01:00:00.000Z'),
      ('state-2', 'event-2', 'user-1', '2026-08-17T01:00:00.000Z', '2026-08-17T01:00:00.000Z', '2026-08-17T01:00:00.000Z');
  `);
});

describe("ChangeEventRepository isolation and user state", () => {
  it("lists only the requested project and hides dismissed events", async () => {
    const rows = await repository.listForProject({
      projectId: "project-a",
      userId: "user-1",
      unreadOnly: false,
      limit: 50,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event).toMatchObject({
      id: "event-1",
      projectId: "project-a",
    });
    expect(typeof rows[0]?.readAt).toBe("string");
    await expect(repository.countUnread("project-a", "user-1")).resolves.toBe(
      0,
    );
  });

  it("keeps read state per user", async () => {
    const rows = await repository.listForProject({
      projectId: "project-a",
      userId: "user-2",
      unreadOnly: true,
      limit: 50,
    });
    expect(rows.map(({ event }) => event.id)).toEqual(["event-1", "event-2"]);
    await expect(repository.countUnread("project-a", "user-2")).resolves.toBe(
      2,
    );
  });

  it("scopes state mutations to the event's project", async () => {
    await expect(
      repository.markRead({
        eventId: "event-b",
        projectId: "project-a",
        userId: "user-1",
        now: "2026-08-18T01:00:00.000Z",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.markRead({
        eventId: "event-1",
        projectId: "project-a",
        userId: "user-2",
        now: "2026-08-18T01:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(repository.countUnread("project-a", "user-2")).resolves.toBe(
      1,
    );
  });

  it("deduplicates a detector replay", async () => {
    await repository.insert({
      id: "duplicate-id",
      projectId: "project-a",
      source: "audit",
      eventType: "audit.regression",
      severity: "warning",
      title: "Duplicate",
      summary: "Duplicate",
      dedupeKey: "audit:1",
      occurredAt: "2026-08-19T00:00:00.000Z",
      detectedAt: "2026-08-19T00:00:00.000Z",
    });
    const result = await client.execute(
      "SELECT COUNT(*) AS total FROM project_change_events WHERE project_id = 'project-a' AND source = 'audit' AND dedupe_key = 'audit:1'",
    );
    expect(result.rows[0]?.total).toBe(1);
  });
});
