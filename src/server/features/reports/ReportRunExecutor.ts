import {
  reportSectionKeySchema,
  reportSnapshotSchema,
} from "@/types/schemas/reports";
import type { ReportBranding } from "@/types/schemas/reports";
import type { ReportRepository } from "./repositories/ReportRepository";
import {
  assembleReportSnapshot,
  stableReportSnapshotJson,
} from "./ReportSnapshotAssembler";
import type { ReportSectionDataSource } from "./ReportSnapshotAssembler";
import { resolveReportBranding } from "./branding";
import type { ReportEmailProvider, ReportPdfRenderer } from "./providers";

type ExecutorRepository = Pick<
  typeof ReportRepository,
  | "getRunScoped"
  | "claimQueuedRun"
  | "transitionRun"
  | "getTemplateSections"
  | "listRecipients"
  | "ensureDeliveries"
  | "listDeliveries"
  | "incrementDeliveryAttempt"
  | "markDeliverySent"
  | "markDeliveryFailed"
  | "upsertArtifact"
>;

export type ReportRunExecutorDependencies = {
  repository: ExecutorRepository;
  source: ReportSectionDataSource;
  pdfRenderer: ReportPdfRenderer;
  emailProvider: ReportEmailProvider;
  now: () => Date;
};

function normalizeStoredDateTime(value: string) {
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
  const candidate = explicitZone ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export async function executeReportRun(
  input: {
    runId: string;
    projectId: string;
    organizationId: string;
    brandingOverride?: ReportBranding;
  },
  dependencies: ReportRunExecutorDependencies,
) {
  const scoped = await dependencies.repository.getRunScoped(input);
  if (!scoped) return { status: "not_found" as const, executed: false };
  if (scoped.run.status === "completed" || scoped.run.status === "failed") {
    return { status: scoped.run.status, executed: false };
  }

  // Only the caller that wins queued -> rendering performs side effects.
  const claimed = await dependencies.repository.claimQueuedRun(
    input.runId,
    input.projectId,
  );
  if (!claimed) return { status: scoped.run.status, executed: false };

  try {
    const generatedAt = normalizeStoredDateTime(claimed.startedAt);
    const snapshot = claimed.snapshotJson
      ? reportSnapshotSchema.parse(JSON.parse(claimed.snapshotJson) as unknown)
      : await assembleReportSnapshot(
          {
            generatedAt,
            project: {
              id: scoped.project.id,
              name: scoped.project.name,
              domain: scoped.project.domain,
            },
            periodStart: claimed.periodStart,
            periodEnd: claimed.periodEnd,
            branding: resolveReportBranding(
              scoped.template,
              input.brandingOverride,
            ),
            sections: (
              await dependencies.repository.getTemplateSections(
                scoped.template.id,
              )
            ).map((section) => ({
              key: reportSectionKeySchema.parse(section.sectionKey),
              enabled: section.isEnabled,
            })),
          },
          dependencies.source,
        );

    const snapshotJson = stableReportSnapshotJson(snapshot);
    await dependencies.repository.transitionRun({
      runId: input.runId,
      projectId: input.projectId,
      from: ["rendering"],
      values: { snapshotJson },
    });

    const pdf = await dependencies.pdfRenderer.render({
      runId: input.runId,
      snapshot,
      idempotencyKey: `report:${input.runId}:pdf`,
    });
    if (pdf.status === "failed") throw new Error(pdf.error);
    if (pdf.status === "rendered") {
      await dependencies.repository.upsertArtifact({
        id: crypto.randomUUID(),
        runId: input.runId,
        kind: "pdf",
        ...pdf.artifact,
      });
    }

    const recipients = claimed.scheduleId
      ? await dependencies.repository.listRecipients(claimed.scheduleId)
      : [];
    await dependencies.repository.ensureDeliveries(
      recipients.map((recipient) => ({
        id: crypto.randomUUID(),
        runId: input.runId,
        recipientId: recipient.id,
        email: recipient.email,
        status: "pending" as const,
      })),
    );

    const sending = await dependencies.repository.transitionRun({
      runId: input.runId,
      projectId: input.projectId,
      from: ["rendering"],
      values: {
        status: "sending",
        deliveryAttempts: claimed.deliveryAttempts + 1,
      },
    });
    if (!sending) return { status: "rendering" as const, executed: false };

    const deliveries = await dependencies.repository.listDeliveries(
      input.runId,
    );
    let failed = false;
    for (const delivery of deliveries) {
      if (delivery.status === "sent") continue;
      const attempt = await dependencies.repository.incrementDeliveryAttempt(
        delivery.id,
      );
      if (!attempt) continue;
      const recipient = recipients.find(
        (candidate) => candidate.id === delivery.recipientId,
      );
      const result = await dependencies.emailProvider.send({
        to: { email: delivery.email, name: recipient?.name ?? null },
        subject: `${snapshot.branding.brandName} SEO report — ${snapshot.project.name}`,
        snapshot,
        pdfStorageKey:
          pdf.status === "rendered" ? pdf.artifact.storageKey : null,
        idempotencyKey: `report:${input.runId}:email:${delivery.id}`,
      });
      if (result.status === "sent") {
        await dependencies.repository.markDeliverySent({
          deliveryId: delivery.id,
          providerMessageId: result.providerMessageId,
          sentAt: dependencies.now().toISOString(),
        });
      } else {
        failed = true;
        await dependencies.repository.markDeliveryFailed(
          delivery.id,
          result.status === "unconfigured"
            ? "report_email_provider_unconfigured"
            : result.error,
        );
      }
    }

    const completedAt = dependencies.now().toISOString();
    await dependencies.repository.transitionRun({
      runId: input.runId,
      projectId: input.projectId,
      from: ["sending"],
      values: failed
        ? {
            status: "failed",
            errorMessage: "One or more report deliveries failed.",
            completedAt,
          }
        : { status: "completed", errorMessage: null, completedAt },
    });
    return {
      status: failed ? ("failed" as const) : ("completed" as const),
      executed: true,
      renderer: pdf.status,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Report failed";
    await dependencies.repository.transitionRun({
      runId: input.runId,
      projectId: input.projectId,
      from: ["rendering", "sending"],
      values: {
        status: "failed",
        errorMessage: message,
        completedAt: dependencies.now().toISOString(),
      },
    });
    return { status: "failed" as const, executed: true };
  }
}
