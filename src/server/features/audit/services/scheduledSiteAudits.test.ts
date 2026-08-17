import { beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduledSiteAudits } from "./scheduledSiteAudits";
import type { AuditScheduleSkipReason } from "@/shared/audit-schedule";

type DueScheduleRow = {
  id: string;
  projectId: string;
  createdByUserId: string;
  startUrl: string;
  maxPages: number;
  lighthouseStrategy: "auto" | "none";
  scheduleInterval: "daily" | "weekly" | "monthly" | "manual";
  nextRunAt: string | null;
  organizationId: string;
};

type ClaimInput = {
  scheduleId: string;
  projectId: string;
  observedNextRunAt: string;
  nextRunAt: string;
  lastSkipReason?: AuditScheduleSkipReason | null;
};

// Typed so assertions can read `mock.calls` without tripping the type-aware
// lint rules on `any`.
const mocks = vi.hoisted(() => ({
  getDueSchedulesWithOrganization:
    vi.fn<(nowIso: string) => Promise<DueScheduleRow[]>>(),
  claimDueSchedule: vi.fn<(input: ClaimInput) => Promise<boolean>>(),
  recordSkip:
    vi.fn<
      (input: {
        scheduleId: string;
        projectId: string;
        reason: AuditScheduleSkipReason;
      }) => Promise<void>
    >(),
  recordRunStarted:
    vi.fn<
      (input: {
        scheduleId: string;
        projectId: string;
        auditId: string;
        lastRunAt: string;
      }) => Promise<void>
    >(),
  hasActiveAuditForProject: vi.fn<(projectId: string) => Promise<boolean>>(),
  resolveAuditLimitTier: vi.fn<(organizationId: string) => Promise<string>>(),
  startAudit:
    vi.fn<(input: { projectId: string }) => Promise<{ auditId: string }>>(),
}));

vi.mock("@/server/features/audit/repositories/AuditScheduleRepository", () => ({
  AuditScheduleRepository: {
    getDueSchedulesWithOrganization: mocks.getDueSchedulesWithOrganization,
    claimDueSchedule: mocks.claimDueSchedule,
    recordSkip: mocks.recordSkip,
    recordRunStarted: mocks.recordRunStarted,
  },
}));
vi.mock("@/server/features/audit/repositories/auditRunQueries", () => ({
  hasActiveAuditForProject: mocks.hasActiveAuditForProject,
}));
vi.mock("@/server/features/audit/services/AuditService", () => ({
  AuditService: {
    resolveAuditLimitTier: mocks.resolveAuditLimitTier,
    startAudit: mocks.startAudit,
  },
}));

const DAY_MS = 86_400_000;

function dueSchedule(overrides: Partial<DueScheduleRow> = {}): DueScheduleRow {
  return {
    id: "schedule_1",
    projectId: "project_1",
    createdByUserId: "user_1",
    startUrl: "https://acme.com/",
    maxPages: 50,
    lighthouseStrategy: "auto",
    scheduleInterval: "daily",
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    organizationId: "org_1",
    ...overrides,
  };
}

describe("runScheduledSiteAudits", () => {
  beforeEach(() => {
    mocks.getDueSchedulesWithOrganization.mockResolvedValue([dueSchedule()]);
    mocks.claimDueSchedule.mockResolvedValue(true);
    mocks.hasActiveAuditForProject.mockResolvedValue(false);
    mocks.resolveAuditLimitTier.mockResolvedValue("paid");
    mocks.startAudit.mockResolvedValue({ auditId: "audit_1" });
  });

  it("does nothing when no schedule is due", async () => {
    mocks.getDueSchedulesWithOrganization.mockResolvedValue([]);

    await runScheduledSiteAudits();

    expect(mocks.hasActiveAuditForProject).not.toHaveBeenCalled();
    expect(mocks.claimDueSchedule).not.toHaveBeenCalled();
    expect(mocks.startAudit).not.toHaveBeenCalled();
  });

  it("claims the slot before starting the audit and records the run", async () => {
    const schedule = dueSchedule();
    mocks.getDueSchedulesWithOrganization.mockResolvedValue([schedule]);

    await runScheduledSiteAudits();

    expect(mocks.claimDueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "schedule_1",
        projectId: "project_1",
        observedNextRunAt: schedule.nextRunAt,
        lastSkipReason: null,
      }),
    );
    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user_1",
        projectId: "project_1",
        startUrl: "https://acme.com/",
        maxPages: 50,
        lighthouseStrategy: "auto",
        limitTier: "paid",
      }),
    );
    expect(mocks.recordRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "schedule_1",
        projectId: "project_1",
        auditId: "audit_1",
      }),
    );
  });

  it("skips without consuming the occurrence while an audit is running", async () => {
    mocks.hasActiveAuditForProject.mockResolvedValue(true);

    await runScheduledSiteAudits();

    expect(mocks.recordSkip).toHaveBeenCalledWith({
      scheduleId: "schedule_1",
      projectId: "project_1",
      reason: "audit_running",
    });
    expect(mocks.claimDueSchedule).not.toHaveBeenCalled();
    expect(mocks.startAudit).not.toHaveBeenCalled();
  });

  it("collapses an overdue anchor to the next future occurrence", async () => {
    const anchor = new Date(Date.now() - 10 * DAY_MS).toISOString();
    mocks.getDueSchedulesWithOrganization.mockResolvedValue([
      dueSchedule({ nextRunAt: anchor }),
    ]);

    await runScheduledSiteAudits();

    expect(mocks.claimDueSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.startAudit).toHaveBeenCalledTimes(1);
    const advanced = Date.parse(
      mocks.claimDueSchedule.mock.calls[0][0].nextRunAt,
    );
    expect(advanced).toBeGreaterThan(Date.now());
    expect(advanced).toBeLessThanOrEqual(Date.now() + DAY_MS);
  });

  it("does not start an audit when another tick won the claim", async () => {
    mocks.claimDueSchedule.mockResolvedValue(false);

    await runScheduledSiteAudits();

    expect(mocks.startAudit).not.toHaveBeenCalled();
    expect(mocks.recordRunStarted).not.toHaveBeenCalled();
  });

  it("advances an unentitled org with a plan_required reason", async () => {
    mocks.resolveAuditLimitTier.mockRejectedValue(
      new Error("PAYMENT_REQUIRED"),
    );

    await runScheduledSiteAudits();

    expect(mocks.claimDueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ lastSkipReason: "plan_required" }),
    );
    expect(mocks.startAudit).not.toHaveBeenCalled();
  });

  it("records a skip reason when the audit refuses to start", async () => {
    mocks.startAudit.mockRejectedValue(new Error("AUDIT_CAPACITY_REACHED"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runScheduledSiteAudits();

    expect(mocks.recordSkip).toHaveBeenCalledWith({
      scheduleId: "schedule_1",
      projectId: "project_1",
      reason: "start_failed",
    });
    expect(mocks.recordRunStarted).not.toHaveBeenCalled();
  });

  it("keeps every write and audit scoped to the schedule's own project", async () => {
    mocks.getDueSchedulesWithOrganization.mockResolvedValue([
      dueSchedule(),
      dueSchedule({
        id: "schedule_2",
        projectId: "project_2",
        createdByUserId: "user_2",
        organizationId: "org_2",
        startUrl: "https://beta.test/",
      }),
    ]);
    mocks.hasActiveAuditForProject.mockImplementation((projectId) =>
      Promise.resolve(projectId === "project_2"),
    );

    await runScheduledSiteAudits();

    expect(mocks.startAudit).toHaveBeenCalledTimes(1);
    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_1" }),
    );
    expect(mocks.claimDueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "schedule_1",
        projectId: "project_1",
      }),
    );
    expect(mocks.recordSkip).toHaveBeenCalledWith({
      scheduleId: "schedule_2",
      projectId: "project_2",
      reason: "audit_running",
    });
  });
});
