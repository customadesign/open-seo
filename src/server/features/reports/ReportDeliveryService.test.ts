import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSnapshot } from "@/types/schemas/reports";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  listCommentary: vi.fn(),
  createRun: vi.fn(),
  ensureSettings: vi.fn(),
  startWorkflow: vi.fn(),
  getProfileById: vi.fn(),
  getProfileRecipients: vi.fn(),
  insertDeliveries: vi.fn(),
  listSendableDeliveries: vi.fn(),
  recordDeliveryResult: vi.fn(),
  upsertArtifact: vi.fn(),
  listArtifacts: vi.fn(),
  createShareLink: vi.fn(),
  listDueProfiles: vi.fn(),
  claimProfile: vi.fn(),
  listExpiredArtifacts: vi.fn(),
  deleteArtifacts: vi.fn(),
  deleteShareLinksExpiredBefore: vi.fn(),
  render: vi.fn(),
  send: vi.fn(),
  bucketDelete: vi.fn(),
  recordSafely: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  customerHasPaidPlan: vi.fn(),
}));

vi.mock("./repositories/ReportRepository", () => ({
  DEFAULT_REPORT_SECTIONS: [],
  ReportRepository: {
    getRun: mocks.getRun,
    listCommentary: mocks.listCommentary,
    createRun: mocks.createRun,
  },
}));

vi.mock("./repositories/ReportDeliveryProfileRepository", () => ({
  ReportDeliveryProfileRepository: {
    getProfileById: mocks.getProfileById,
    getProfileRecipients: mocks.getProfileRecipients,
    listDueProfiles: mocks.listDueProfiles,
    claimProfile: mocks.claimProfile,
  },
}));

vi.mock("./repositories/ReportDeliveryRepository", () => ({
  ReportDeliveryRepository: {
    insertDeliveries: mocks.insertDeliveries,
    listSendableDeliveries: mocks.listSendableDeliveries,
    recordDeliveryResult: mocks.recordDeliveryResult,
    upsertArtifact: mocks.upsertArtifact,
    listArtifacts: mocks.listArtifacts,
    createShareLink: mocks.createShareLink,
    listExpiredArtifacts: mocks.listExpiredArtifacts,
    deleteArtifacts: mocks.deleteArtifacts,
    deleteShareLinksExpiredBefore: mocks.deleteShareLinksExpiredBefore,
  },
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
      pdfRenderer: { configured: true, render: mocks.render },
      emailProvider: { configured: true, send: mocks.send },
      shareBaseUrl: "https://app.example.com",
      bucket: { delete: mocks.bucketDelete },
    }),
}));

vi.mock("@/server/features/change-events/services/ChangeEventService", () => ({
  ChangeEventService: { recordSafely: mocks.recordSafely },
}));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
  getOptionalEnvValue: (name: string) =>
    Promise.resolve(process.env[name] ?? undefined),
}));

vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
}));

import { ReportDeliveryService } from "./ReportDeliveryService";
import { ReportDeliveryProfileService } from "./ReportDeliveryProfileService";
import { ReportShareService } from "./ReportShareService";

const snapshot: ReportSnapshot = {
  version: 1,
  generatedAt: "2026-08-17T00:00:00.000Z",
  project: { id: "project-1", name: "Acme Co", domain: "acme.test" },
  period: { start: "2026-07-01", end: "2026-07-31" },
  comparisonPeriod: { start: "2026-06-01", end: "2026-06-30" },
  sections: [],
  omissions: [],
  evidence: [],
};

const publishedRun = {
  id: "run-1",
  projectId: "project-1",
  status: "published",
  profileId: "profile-1",
  snapshotJson: JSON.stringify(snapshot),
};

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

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    runId: "run-1",
    email: "client@acme.test",
    name: null,
    attempts: 0,
    idempotencyKey: "report:run-1:client@acme.test",
    ...overrides,
  };
}

beforeEach(() => {
  // Delivery is fail-closed, so the production path needs the explicit opt-out.
  process.env.REPORT_DELIVERY_TEST_MODE = "false";
  delete process.env.REPORT_TEST_RECIPIENTS;
  mocks.getRun.mockResolvedValue(publishedRun);
  mocks.listCommentary.mockResolvedValue([]);
  mocks.getProfileById.mockResolvedValue(profile);
  mocks.getProfileRecipients.mockResolvedValue([
    { id: "recipient-1", email: "client@acme.test", name: "Client" },
  ]);
  mocks.listSendableDeliveries.mockResolvedValue([delivery()]);
  mocks.listArtifacts.mockResolvedValue([]);
  mocks.render.mockResolvedValue({
    status: "rendered",
    artifact: {
      storageKey: "reports/run-1/report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      checksumSha256: "abc",
    },
  });
  mocks.send.mockResolvedValue({ status: "sent", providerMessageId: "msg-1" });
  mocks.isHostedServerAuthMode.mockResolvedValue(false);
});

describe("deliverRun", () => {
  it("renders, stores and mails the published run", async () => {
    const result = await ReportDeliveryService.deliverRun({
      projectId: "project-1",
      runId: "run-1",
      now,
    });

    expect(result).toMatchObject({ pdf: "rendered", sent: 1, failed: 0 });
    expect(mocks.upsertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        kind: "pdf",
        storageKey: "reports/run-1/report.pdf",
        // 13-month retention horizon, stamped at delivery time.
        expiresAt: "2027-09-17T00:00:00.000Z",
      }),
    );
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "report:run-1:client@acme.test",
        pdfStorageKey: "reports/run-1/report.pdf",
        shareUrl: result.shareUrl,
      }),
    );
    expect(result.shareUrl).toMatch(
      /^https:\/\/app\.example\.com\/api\/reports\/share\/[\w-]{43}$/u,
    );
    expect(mocks.insertDeliveries).toHaveBeenCalledWith([
      expect.objectContaining({ email: "client@acme.test", status: "pending" }),
    ]);
    expect(mocks.recordDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", attempts: 1 }),
    );
  });

  it("holds back recipients that are not allowlisted in test mode", async () => {
    delete process.env.REPORT_DELIVERY_TEST_MODE;
    process.env.REPORT_TEST_RECIPIENTS = "qa@agency.test";
    mocks.listSendableDeliveries.mockResolvedValue([]);

    const result = await ReportDeliveryService.deliverRun({
      projectId: "project-1",
      runId: "run-1",
      now,
    });

    expect(result.skipped).toBe(1);
    expect(mocks.insertDeliveries).toHaveBeenCalledWith([
      expect.objectContaining({ email: "client@acme.test", status: "skipped" }),
    ]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records a failed delivery and raises a change event", async () => {
    mocks.send.mockResolvedValue({
      status: "failed",
      error: "Email provider returned HTTP 500.",
      retryable: true,
    });

    const result = await ReportDeliveryService.deliverRun({
      projectId: "project-1",
      runId: "run-1",
      now,
    });

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.recordDeliveryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        attempts: 1,
        errorMessage: "Email provider returned HTTP 500.",
      }),
    );
    expect(mocks.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "reports.delivery_failed" }),
    );
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
    mocks.ensureSettings.mockResolvedValue({ id: "settings-1" });
    mocks.createRun.mockResolvedValue({ id: "run-2", status: "queued" });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- focused Workflow binding stub
    const workflow = {} as Env["REPORT_WORKFLOW"];

    await expect(
      ReportDeliveryProfileService.processDueProfiles(workflow, now),
    ).resolves.toEqual({ started: 1, errors: 0 });
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
      ReportDeliveryProfileService.processDueProfiles(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- focused Workflow binding stub
        {} as Env["REPORT_WORKFLOW"],
        now,
      ),
    ).resolves.toEqual({ started: 0, errors: 0 });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredArtifacts", () => {
  it("deletes the stored object before dropping its row", async () => {
    mocks.listExpiredArtifacts.mockResolvedValue([
      { id: "artifact-1", storageKey: "reports/run-1/report.pdf" },
    ]);
    mocks.deleteShareLinksExpiredBefore.mockResolvedValue(3);

    await expect(
      ReportShareService.purgeExpiredArtifacts(now),
    ).resolves.toEqual({ artifacts: 1, shareLinks: 3 });
    expect(mocks.bucketDelete).toHaveBeenCalledWith("reports/run-1/report.pdf");
    expect(mocks.deleteArtifacts).toHaveBeenCalledWith(["artifact-1"]);
    // Share rows outlive their expiry by the retention window.
    expect(mocks.deleteShareLinksExpiredBefore).toHaveBeenCalledWith(
      "2026-05-19T00:00:00.000Z",
    );
  });
});
