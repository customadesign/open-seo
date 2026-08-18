import { describe, expect, it, vi } from "vitest";
import {
  executeReportRun,
  type ReportRunExecutorDependencies,
} from "./ReportRunExecutor";
import type { ReportEmailProvider } from "./providers";
import { unconfiguredReportPdfRenderer } from "./providers";
import type { ReportSectionDataSource } from "./ReportSnapshotAssembler";

describe("report run retries and idempotency", () => {
  it("reuses the persisted snapshot, retries failed delivery, and no-ops after completion", async () => {
    const run = {
      id: "run-1",
      projectId: "project-1",
      templateId: "template-1",
      scheduleId: "schedule-1",
      status: "queued" as
        | "queued"
        | "rendering"
        | "sending"
        | "completed"
        | "failed",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      snapshotJson: null as string | null,
      deliveryAttempts: 0,
      errorMessage: null as string | null,
      startedAt: "2026-08-01 01:00:00",
      completedAt: null as string | null,
    };
    const delivery = {
      id: "delivery-1",
      runId: run.id,
      recipientId: "recipient-1",
      email: "owner@example.com",
      status: "pending" as "pending" | "sent" | "failed",
      attempts: 0,
      providerMessageId: null as string | null,
      errorMessage: null as string | null,
      sentAt: null as string | null,
      createdAt: "2026-08-01T01:00:00.000Z",
    };
    const sourceLoad = vi.fn();
    const source: ReportSectionDataSource = {
      async load() {
        sourceLoad();
        return { status: "available", data: { pagesCrawled: 10 } };
      },
    };
    const idempotencyKeys: string[] = [];
    let sendAttempt = 0;
    const emailProvider: ReportEmailProvider = {
      configured: true,
      async send(input) {
        idempotencyKeys.push(input.idempotencyKey);
        sendAttempt += 1;
        return sendAttempt === 1
          ? { status: "failed", error: "temporary" }
          : { status: "sent", providerMessageId: "msg-1" };
      },
    };

    const repository: ReportRunExecutorDependencies["repository"] = {
      getRunScoped: async () => ({
        run: { ...run },
        template: {
          id: "template-1",
          organizationId: "org-1",
          projectId: "project-1",
          name: "SEO report",
          isDefault: false,
          brandName: null,
          logoUrl: null,
          primaryColor: null,
          accentColor: null,
          createdByUserId: null,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          deletedAt: null,
        },
        project: {
          id: "project-1",
          organizationId: "org-1",
          name: "Site",
          domain: "example.com",
          locationCode: 2840,
          languageCode: "en",
          createdAt: "2026-08-01T00:00:00.000Z",
          archivedAt: null,
        },
      }),
      claimQueuedRun: async () => {
        if (run.status !== "queued") throw new Error("unexpected claim");
        run.status = "rendering";
        return { ...run };
      },
      transitionRun: async (input) => {
        if (!input.from.includes(run.status)) {
          throw new Error("unexpected transition");
        }
        Object.assign(run, input.values);
        return { ...run };
      },
      getTemplateSections: async () => [
        {
          id: "section-1",
          templateId: "template-1",
          sectionKey: "audit",
          sortOrder: 0,
          isEnabled: true,
        },
      ],
      listRecipients: async () => [
        {
          id: "recipient-1",
          scheduleId: "schedule-1",
          email: "owner@example.com",
          name: "Owner",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      ensureDeliveries: async () => undefined,
      listDeliveries: async () => [{ ...delivery }],
      incrementDeliveryAttempt: async () => {
        if (delivery.status === "sent") throw new Error("unexpected attempt");
        delivery.attempts += 1;
        return { ...delivery };
      },
      markDeliverySent: async (input) => {
        delivery.status = "sent";
        delivery.providerMessageId = input.providerMessageId;
      },
      markDeliveryFailed: async (_id, error) => {
        delivery.status = "failed";
        delivery.errorMessage = error;
      },
      upsertArtifact: async () => undefined,
    };
    const dependencies: ReportRunExecutorDependencies = {
      repository,
      source,
      pdfRenderer: unconfiguredReportPdfRenderer,
      emailProvider,
      now: () => new Date("2026-08-01T02:00:00.000Z"),
    };
    const input = {
      runId: run.id,
      projectId: run.projectId,
      organizationId: "org-1",
    };

    await expect(executeReportRun(input, dependencies)).resolves.toMatchObject({
      status: "failed",
      executed: true,
    });
    expect(sourceLoad).toHaveBeenCalledTimes(1);
    expect(run.snapshotJson).not.toBeNull();
    expect(JSON.parse(run.snapshotJson ?? "{}")).toMatchObject({
      generatedAt: "2026-08-01T01:00:00.000Z",
    });
    expect(delivery.attempts).toBe(1);

    run.status = "queued";
    run.errorMessage = null;
    await expect(executeReportRun(input, dependencies)).resolves.toMatchObject({
      status: "completed",
      executed: true,
    });
    expect(sourceLoad).toHaveBeenCalledTimes(1);
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(delivery.attempts).toBe(2);

    await expect(executeReportRun(input, dependencies)).resolves.toEqual({
      status: "completed",
      executed: false,
    });
    expect(idempotencyKeys).toHaveLength(2);
  });
});
