import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  listDueProfiles: vi.fn(),
  claimProfile: vi.fn(),
  createRun: vi.fn(),
  ensureSettings: vi.fn(),
  startWorkflow: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  customerHasPaidPlan: vi.fn(),
}));

vi.mock("./repositories/ReportDeliveryProfileRepository", () => ({
  ReportDeliveryProfileRepository: {
    listProfiles: mocks.listProfiles,
    listDueProfiles: mocks.listDueProfiles,
    claimProfile: mocks.claimProfile,
  },
}));

vi.mock("./repositories/ReportRepository", () => ({
  DEFAULT_REPORT_SECTIONS: [],
  ReportRepository: { createRun: mocks.createRun },
}));

vi.mock("./ReportService", () => ({
  ReportService: {
    ensureSettings: mocks.ensureSettings,
    startWorkflow: mocks.startWorkflow,
    assertPaidPlan: vi.fn(),
  },
}));

vi.mock("./defaultReportProviders", () => ({
  getReportProviders: () =>
    Promise.resolve({
      pdfRenderer: { configured: true },
      emailProvider: { configured: true },
      shareBaseUrl: "https://app.example.com",
    }),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
  getOptionalEnvValue: (name: string) =>
    Promise.resolve(process.env[name] ?? undefined),
}));

vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
}));

import { ReportDeliveryProfileService } from "./ReportDeliveryProfileService";

const profile = {
  id: "profile-1",
  projectId: "project-1",
  name: "Client monthly",
  frequency: "monthly" as const,
  timeZone: "UTC",
  runDay: 4,
  runWeekday: null,
  runHour: 9,
  isEnabled: true,
  brandName: "Acme SEO",
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  attachPdf: true,
  includeShareLink: true,
  shareLinkTtlDays: 30,
  nextRunAt: "2026-09-04T09:00:00.000Z",
  lastRunAt: null,
};

const now = new Date("2026-08-17T00:00:00.000Z");

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- focused Workflow binding stub
const workflow = {} as Env["REPORT_WORKFLOW"];

beforeEach(() => {
  // Delivery is fail-closed, so the production path needs the explicit opt-out.
  process.env.REPORT_DELIVERY_TEST_MODE = "false";
  delete process.env.REPORT_TEST_RECIPIENTS;
  mocks.isHostedServerAuthMode.mockResolvedValue(false);
  mocks.ensureSettings.mockResolvedValue({ id: "settings-1" });
  mocks.createRun.mockResolvedValue({ id: "run-2", status: "queued" });
});

describe("listProfiles", () => {
  // Without this the Reports page cannot tell a working profile from one whose
  // every scheduled send is silently recorded as skipped.
  it("reports the fail-closed guard state and which recipients it holds back", async () => {
    delete process.env.REPORT_DELIVERY_TEST_MODE;
    process.env.REPORT_TEST_RECIPIENTS = "qa@agency.test";
    mocks.listProfiles.mockResolvedValue([
      {
        profile,
        sections: [],
        recipients: [
          { email: "qa@agency.test", name: null },
          { email: "client@acme.test", name: "Client" },
        ],
      },
    ]);

    const result = await ReportDeliveryProfileService.listProfiles("project-1");

    expect(result.delivery).toEqual({ testMode: true, allowlistSize: 1 });
    expect(result.profiles[0].recipients).toEqual([
      { email: "qa@agency.test", name: null, isAllowed: true },
      { email: "client@acme.test", name: "Client", isAllowed: false },
    ]);
  });
});

describe("processDueProfiles", () => {
  it("starts one run per claimed profile", async () => {
    mocks.listDueProfiles.mockResolvedValue([
      {
        profile: { ...profile, nextRunAt: "2026-08-04T09:00:00.000Z" },
        organizationId: "org-1",
      },
    ]);
    mocks.claimProfile.mockResolvedValue(true);

    await expect(
      ReportDeliveryProfileService.processDueProfiles(workflow, now),
    ).resolves.toEqual({
      started: 1,
      skippedFree: 0,
      skippedStale: 0,
      errors: 0,
    });
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        trigger: "scheduled",
        scheduledKey: "profile:profile-1:2026-08-04T09:00:00.000Z",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    );
    expect(mocks.startWorkflow).toHaveBeenCalledOnce();
  });

  it("does not run a profile another tick already claimed", async () => {
    mocks.listDueProfiles.mockResolvedValue([
      {
        profile: { ...profile, nextRunAt: "2026-08-04T09:00:00.000Z" },
        organizationId: "org-1",
      },
    ]);
    mocks.claimProfile.mockResolvedValue(false);

    await expect(
      ReportDeliveryProfileService.processDueProfiles(workflow, now),
    ).resolves.toEqual({
      started: 0,
      skippedFree: 0,
      skippedStale: 0,
      errors: 0,
    });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  // Advancing one occurrence per tick leaves the profile due again immediately,
  // so a deployment that was down for 48 days would mail 48 daily reports as
  // the scheduler caught up.
  it("collapses a 48-day-stale daily profile to a single run", async () => {
    const catchUpNow = new Date("2026-08-17T12:00:00.000Z");
    let storedNextRunAt = "2026-06-30T09:00:00.000Z";
    const dailyProfile = {
      ...profile,
      frequency: "daily" as const,
      runDay: null,
      runWeekday: null,
      runHour: 9,
    };
    mocks.listDueProfiles.mockImplementation((nowIso: string) =>
      Promise.resolve(
        storedNextRunAt <= nowIso
          ? [
              {
                profile: { ...dailyProfile, nextRunAt: storedNextRunAt },
                organizationId: "org-1",
              },
            ]
          : [],
      ),
    );
    mocks.claimProfile.mockImplementation(
      (input: { observedNextRunAt: string; nextRunAt: string }) => {
        if (input.observedNextRunAt !== storedNextRunAt) {
          return Promise.resolve(false);
        }
        storedNextRunAt = input.nextRunAt;
        return Promise.resolve(true);
      },
    );

    for (let tick = 0; tick < 48; tick += 1) {
      await ReportDeliveryProfileService.processDueProfiles(
        workflow,
        catchUpNow,
      );
    }

    expect(mocks.createRun).toHaveBeenCalledOnce();
    // The one report covers the newest missed window, not the oldest.
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledKey: "profile:profile-1:2026-08-17T09:00:00.000Z",
        periodStart: "2026-08-16",
        periodEnd: "2026-08-16",
      }),
    );
    expect(storedNextRunAt).toBe("2026-08-18T09:00:00.000Z");
  });
});
