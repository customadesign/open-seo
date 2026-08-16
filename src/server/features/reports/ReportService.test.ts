import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSections: vi.fn(),
  createDefaultSettings: vi.fn(),
  listRuns: vi.fn(),
  listDueSettings: vi.fn(),
  claimDueSettings: vi.fn(),
  createRun: vi.fn(),
  failRun: vi.fn(),
}));

vi.mock("./repositories/ReportRepository", () => ({
  DEFAULT_REPORT_SECTIONS: [
    { key: "rankings", enabled: true },
    { key: "gsc", enabled: true },
    { key: "ga4", enabled: true },
    { key: "google_ads", enabled: true },
    { key: "audit", enabled: true },
    { key: "backlinks", enabled: true },
  ],
  ReportRepository: {
    ...mocks,
  },
}));

import { ReportService } from "./ReportService";

function workflow() {
  const create = vi.fn();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- focused Workflow binding stub
  const binding = { create } as unknown as Env["REPORT_WORKFLOW"];
  return { binding, create };
}

const dueSettings = {
  id: "settings-1",
  projectId: "project-1",
  organizationId: "org-1",
  timeZone: "Asia/Manila",
  runDay: 4,
  runHour: 9,
  isEnabled: true,
  nextRunAt: "2026-08-04T01:00:00.000Z",
  lastRunAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("ReportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRuns.mockResolvedValue([]);
    mocks.getSections.mockResolvedValue([]);
  });

  it("does not create report settings when a client reads an empty dashboard", async () => {
    mocks.getSettings.mockResolvedValue(null);

    const result = await ReportService.getDashboard({
      projectId: "project-1",
      organizationId: "org-1",
      publishedOnly: true,
    });

    expect(mocks.createDefaultSettings).not.toHaveBeenCalled();
    expect(mocks.listRuns).toHaveBeenCalledWith("project-1", true);
    expect(result.settings.isEnabled).toBe(false);
  });

  it("claims and starts one report for a due monthly instant", async () => {
    mocks.listDueSettings.mockResolvedValue([
      { settings: dueSettings, organizationId: "org-1" },
    ]);
    mocks.claimDueSettings.mockResolvedValue(true);
    mocks.createRun.mockResolvedValue({ id: "run-1", status: "queued" });
    const { binding, create } = workflow();

    const result = await ReportService.processDueSchedules(
      binding,
      new Date("2026-08-04T01:02:00.000Z"),
    );

    expect(result).toEqual({ started: 1 });
    expect(mocks.claimDueSettings).toHaveBeenCalledWith({
      settingsId: "settings-1",
      observedNextRunAt: "2026-08-04T01:00:00.000Z",
      nextRunAt: "2026-09-04T01:00:00.000Z",
    });
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        scheduledKey: "settings-1:2026-08-04T01:00:00.000Z",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        compareStart: "2026-06-01",
        compareEnd: "2026-06-30",
      }),
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it("does not start a duplicate when another cron tick won the claim", async () => {
    mocks.listDueSettings.mockResolvedValue([
      { settings: dueSettings, organizationId: "org-1" },
    ]);
    mocks.claimDueSettings.mockResolvedValue(false);
    const { binding, create } = workflow();

    const result = await ReportService.processDueSchedules(binding);

    expect(result).toEqual({ started: 0 });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
