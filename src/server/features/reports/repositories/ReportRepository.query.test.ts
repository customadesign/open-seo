import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ReportRepositoryModule from "./ReportRepository";
import type * as ReportScheduleRepositoryModule from "./ReportScheduleRepository";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

let client: Client;
let ReportRepository: typeof ReportRepositoryModule.ReportRepository;
let ReportScheduleRepository: typeof ReportScheduleRepositoryModule.ReportScheduleRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({ runBatch: vi.fn() }));
  await client.executeMultiple(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL,
      domain TEXT, location_code INTEGER NOT NULL DEFAULT 2840,
      language_code TEXT NOT NULL DEFAULT 'en', created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE report_templates (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT,
      name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
      brand_name TEXT, logo_url TEXT, primary_color TEXT, accent_color TEXT,
      created_by_user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE report_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, template_id TEXT NOT NULL,
      schedule_id TEXT, status TEXT NOT NULL, period_start TEXT NOT NULL,
      period_end TEXT NOT NULL, snapshot_json TEXT,
      delivery_attempts INTEGER NOT NULL DEFAULT 0, error_message TEXT,
      started_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE report_schedules (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, template_id TEXT NOT NULL,
      name TEXT NOT NULL, frequency TEXT NOT NULL, timezone TEXT NOT NULL,
      is_active INTEGER NOT NULL, next_run_at TEXT, last_run_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  ({ ReportRepository } = await import("./ReportRepository"));
  ({ ReportScheduleRepository } = await import("./ReportScheduleRepository"));
});

afterAll(() => client.close());

async function seed() {
  await client.executeMultiple(`
    DELETE FROM report_runs;
    DELETE FROM report_schedules;
    DELETE FROM report_templates;
    DELETE FROM projects;
    INSERT INTO projects VALUES
      ('project-a', 'org-a', 'A', 'a.example', 2840, 'en', '2026-01-01', NULL),
      ('project-a2', 'org-a', 'A2', 'a2.example', 2840, 'en', '2026-01-01', NULL),
      ('project-b', 'org-b', 'B', 'b.example', 2840, 'en', '2026-01-01', NULL);
    INSERT INTO report_templates VALUES
      ('global-a', 'org-a', NULL, 'Global A', 1, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-01-01'),
      ('template-a', 'org-a', 'project-a', 'A report', 0, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-01-01'),
      ('template-a2', 'org-a', 'project-a2', 'A2 report', 0, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-01-01'),
      ('template-b', 'org-b', 'project-b', 'B report', 0, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-01-01'),
      ('spoofed-b', 'org-b', 'project-a', 'Spoofed', 0, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-01-01');
    INSERT INTO report_runs VALUES
      ('run-a', 'project-a', 'template-a', NULL, 'completed', '2026-01-01', '2026-02-01', '{}', 0, NULL, '2026-02-01', '2026-02-01'),
      ('run-cross-template', 'project-a', 'spoofed-b', NULL, 'completed', '2026-01-01', '2026-02-01', '{}', 0, NULL, '2026-02-01', '2026-02-01'),
      ('run-cross-project-template', 'project-a', 'template-a2', NULL, 'completed', '2026-01-01', '2026-02-01', '{}', 0, NULL, '2026-02-01', '2026-02-01'),
      ('run-cross-project', 'project-b', 'template-a', NULL, 'completed', '2026-01-01', '2026-02-01', '{}', 0, NULL, '2026-02-01', '2026-02-01');
    INSERT INTO report_schedules VALUES
      ('due-a', 'project-a', 'template-a', 'Due', 'weekly', 'UTC', 1, '2026-08-01T00:00:00.000Z', NULL, '2026-01-01', '2026-01-01'),
      ('manual-a', 'project-a', 'template-a', 'Manual', 'manual', 'UTC', 1, '2026-08-01T00:00:00.000Z', NULL, '2026-01-01', '2026-01-01'),
      ('future-a', 'project-a', 'template-a', 'Future', 'weekly', 'UTC', 1, '2027-08-01T00:00:00.000Z', NULL, '2026-01-01', '2026-01-01'),
      ('spoofed-schedule', 'project-a', 'template-b', 'Spoofed', 'weekly', 'UTC', 1, '2026-08-01T00:00:00.000Z', NULL, '2026-01-01', '2026-01-01');
  `);
}

describe("ReportRepository tenant and project isolation", () => {
  it("admits only organization templates for the requested project or global scope", async () => {
    await seed();
    const rows = await ReportRepository.listTemplates("org-a", "project-a");
    expect(rows.map((row) => row.id).toSorted()).toEqual([
      "global-a",
      "template-a",
    ]);
    await expect(
      ReportRepository.getTemplateScoped({
        templateId: "template-a2",
        organizationId: "org-a",
        projectId: "project-a",
      }),
    ).resolves.toBeNull();
    await expect(
      ReportRepository.getTemplateScoped({
        templateId: "spoofed-b",
        organizationId: "org-a",
        projectId: "project-a",
      }),
    ).resolves.toBeNull();
  });

  it("requires both the run project and joined template/project tenants", async () => {
    await seed();
    const rows = await ReportRepository.listRuns("org-a", "project-a");
    expect(rows.map(({ run }) => run.id)).toEqual(["run-a"]);
  });

  it("selects tenant-consistent due schedules and claims each instant once", async () => {
    await seed();
    const due = await ReportScheduleRepository.listDueSchedules(
      "2026-08-13T00:00:00.000Z",
    );
    expect(due.map(({ schedule }) => schedule.id)).toEqual(["due-a"]);

    const claim = {
      scheduleId: "due-a",
      observedNextRunAt: "2026-08-01T00:00:00.000Z",
      nextRunAt: "2026-08-08T00:00:00.000Z",
      lastRunAt: "2026-08-01T00:00:00.000Z",
    };
    await expect(
      ReportScheduleRepository.claimSchedule(claim),
    ).resolves.toMatchObject({ id: "due-a" });
    await expect(
      ReportScheduleRepository.claimSchedule(claim),
    ).resolves.toBeNull();
  });
});
