import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import { AppError } from "@/server/lib/errors";
import {
  MAX_REPORT_DELIVERY_ATTEMPTS,
  REPORT_PDF_RETENTION_MONTHS,
} from "@/shared/report-delivery";
import { reportSnapshotSchema } from "@/types/schemas/reports";
import { getReportProviders } from "./defaultReportProviders";
import { resolveReportBranding } from "./reportPresentation";
import type { ReportEmailSendResult } from "./reportProviders";
import {
  isScheduledRecipientAllowed,
  isTestRecipientAllowed,
  loadReportDeliveryGuard,
} from "./reportTestRecipients";
import { ReportDeliveryProfileRepository } from "./repositories/ReportDeliveryProfileRepository";
import { ReportDeliveryRepository } from "./repositories/ReportDeliveryRepository";
import { ReportRepository } from "./repositories/ReportRepository";
import { ReportShareService } from "./ReportShareService";

function addMonths(from: Date, months: number): Date {
  const next = new Date(from.valueOf());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function describeSendFailure(
  result: Exclude<ReportEmailSendResult, { status: "sent" }>,
): string {
  return result.status === "unconfigured"
    ? "No email provider is configured for this deployment."
    : result.error;
}

async function loadPublishedRun(projectId: string, runId: string) {
  const run = await ReportRepository.getRun(projectId, runId);
  if (!run || run.status !== "published" || !run.snapshotJson) {
    throw new AppError("NOT_FOUND", "Published report not found.");
  }
  const commentary = await ReportRepository.listCommentary(run.id);
  return {
    run,
    snapshot: reportSnapshotSchema.parse(
      JSON.parse(run.snapshotJson) as unknown,
    ),
    commentary: commentary.map((item) => ({
      kind: item.kind,
      text: item.text,
    })),
  };
}

async function pdfStorageKeyFor(runId: string): Promise<string | null> {
  const artifacts = await ReportDeliveryRepository.listArtifacts(runId);
  return (
    artifacts.find((artifact) => artifact.kind === "pdf")?.storageKey ?? null
  );
}

/**
 * A share link is only worth minting when the email can carry it: without a
 * configured base URL the token would be unreachable, so no row is created.
 */
async function shareLinkForDelivery(input: {
  profile: { includeShareLink: boolean; shareLinkTtlDays: number } | null;
  projectId: string;
  runId: string;
  now: Date;
}) {
  if (!input.profile?.includeShareLink) return null;
  const { shareBaseUrl } = await getReportProviders();
  if (!shareBaseUrl) return null;
  return ReportShareService.createShareLink({
    projectId: input.projectId,
    runId: input.runId,
    expiresInDays: input.profile.shareLinkTtlDays,
    userId: null,
    now: input.now,
  });
}

type DeliveryOutcome = {
  runId: string;
  pdf: "rendered" | "unconfigured" | "failed" | "skipped";
  shareUrl: string | null;
  sent: number;
  failed: number;
  skipped: number;
};

const NOT_DELIVERED: Omit<DeliveryOutcome, "runId"> = {
  pdf: "skipped",
  shareUrl: null,
  sent: 0,
  failed: 0,
  skipped: 0,
};

/**
 * Renders, stores and mails one published run for its delivery profile. Safe to
 * call again: the PDF key is stable, delivery rows are unique per recipient, and
 * each send carries a stable idempotency key.
 */
async function deliverRun(input: {
  projectId: string;
  runId: string;
  now?: Date;
}): Promise<DeliveryOutcome> {
  const now = input.now ?? new Date();
  const { run, snapshot, commentary } = await loadPublishedRun(
    input.projectId,
    input.runId,
  );
  const profile = run.profileId
    ? await ReportDeliveryProfileRepository.getProfileById(run.profileId)
    : null;
  // Manual runs have no audience; they are read in the app or shared by hand.
  if (!profile) return { runId: run.id, ...NOT_DELIVERED };

  const providers = await getReportProviders();
  const branding = resolveReportBranding(profile);

  let pdf: DeliveryOutcome["pdf"] = "skipped";
  let pdfStorageKey: string | null = null;
  if (profile.attachPdf) {
    const rendered = await providers.pdfRenderer.render({
      runId: run.id,
      snapshot,
      branding,
      commentary,
      idempotencyKey: `report:${run.id}:pdf`,
    });
    pdf = rendered.status === "rendered" ? "rendered" : rendered.status;
    if (rendered.status === "rendered") {
      pdfStorageKey = rendered.artifact.storageKey;
      await ReportDeliveryRepository.upsertArtifact({
        runId: run.id,
        kind: "pdf",
        storageKey: rendered.artifact.storageKey,
        mimeType: rendered.artifact.mimeType,
        sizeBytes: rendered.artifact.sizeBytes,
        checksumSha256: rendered.artifact.checksumSha256,
        expiresAt: addMonths(now, REPORT_PDF_RETENTION_MONTHS).toISOString(),
      });
    }
  }

  const share = await shareLinkForDelivery({
    profile,
    projectId: input.projectId,
    runId: run.id,
    now,
  });

  const guard = await loadReportDeliveryGuard();
  const recipients = await ReportDeliveryProfileRepository.getProfileRecipients(
    profile.id,
  );
  const rows = recipients.map((recipient) => {
    const allowed = isScheduledRecipientAllowed(recipient.email, guard);
    return {
      id: crypto.randomUUID(),
      runId: run.id,
      profileId: profile.id,
      recipientId: recipient.id,
      email: recipient.email,
      name: recipient.name,
      idempotencyKey: `report:${run.id}:${recipient.email}`,
      isTest: false,
      status: allowed ? ("pending" as const) : ("skipped" as const),
      errorMessage: allowed
        ? null
        : "Delivery test mode is on and this address is not allowlisted.",
    };
  });
  await ReportDeliveryRepository.insertDeliveries(rows);

  const outcome = await sendPendingDeliveries({
    run,
    snapshot,
    branding,
    pdfStorageKey,
    shareUrl: share?.url ?? null,
    now,
  });
  return {
    runId: run.id,
    pdf,
    shareUrl: share?.url ?? null,
    ...outcome,
    skipped: rows.filter((row) => row.status === "skipped").length,
  };
}

async function sendPendingDeliveries(input: {
  run: { id: string; projectId: string };
  snapshot: ReturnType<typeof reportSnapshotSchema.parse>;
  branding: ReturnType<typeof resolveReportBranding>;
  pdfStorageKey: string | null;
  shareUrl: string | null;
  now: Date;
}) {
  const { emailProvider } = await getReportProviders();
  const pending = await ReportDeliveryRepository.listSendableDeliveries(
    input.run.id,
    MAX_REPORT_DELIVERY_ATTEMPTS,
  );
  let sent = 0;
  let failed = 0;
  for (const delivery of pending) {
    const attempts = delivery.attempts + 1;
    const result = await emailProvider.send({
      to: { email: delivery.email, name: delivery.name },
      snapshot: input.snapshot,
      branding: input.branding,
      pdfStorageKey: input.pdfStorageKey,
      shareUrl: input.shareUrl,
      idempotencyKey: delivery.idempotencyKey,
    });
    if (result.status === "sent") {
      sent += 1;
      await ReportDeliveryRepository.recordDeliveryResult({
        deliveryId: delivery.id,
        status: "sent",
        attempts,
        providerMessageId: result.providerMessageId,
        sentAt: input.now.toISOString(),
      });
      continue;
    }
    failed += 1;
    await ReportDeliveryRepository.recordDeliveryResult({
      deliveryId: delivery.id,
      status: "failed",
      // A missing provider is a deployment problem, not a bad attempt: leaving
      // the counter alone keeps the retry budget for real send failures.
      attempts: result.status === "unconfigured" ? delivery.attempts : attempts,
      errorMessage: describeSendFailure(result),
    });
  }
  if (failed > 0) {
    await ChangeEventService.recordSafely({
      projectId: input.run.projectId,
      source: "reports",
      eventType: "reports.delivery_failed",
      severity: "warning",
      title: "Report delivery failed",
      summary: `${failed} recipient${failed === 1 ? "" : "s"} did not receive this report.`,
      entityType: "report_run",
      entityId: input.run.id,
      sourceRunId: input.run.id,
      dedupeKey: `report:${input.run.id}:delivery_failed`,
      occurredAt: input.now.toISOString(),
    });
  }
  return { sent, failed };
}

/** Operator-triggered retry of the failed recipients on one run. */
async function retryDeliveries(input: { projectId: string; runId: string }) {
  const now = new Date();
  const { run, snapshot } = await loadPublishedRun(
    input.projectId,
    input.runId,
  );
  const profile = run.profileId
    ? await ReportDeliveryProfileRepository.getProfileById(run.profileId)
    : null;
  const reset = await ReportDeliveryRepository.resetFailedDeliveries(run.id);
  // A stored token is only a hash, so a retry cannot reuse the original link.
  // Minting a new one keeps the retried email as useful as the first attempt;
  // links from the first attempt stay valid until they expire or are revoked.
  const share = await shareLinkForDelivery({
    profile,
    projectId: input.projectId,
    runId: run.id,
    now,
  });
  const outcome = await sendPendingDeliveries({
    run,
    snapshot,
    branding: resolveReportBranding(profile),
    pdfStorageKey: await pdfStorageKeyFor(run.id),
    shareUrl: share?.url ?? null,
    now,
  });
  return { runId: run.id, reset, ...outcome };
}

async function sendTestDelivery(input: {
  projectId: string;
  runId: string;
  email: string;
  requesterEmail: string | null;
}) {
  const guard = await loadReportDeliveryGuard();
  if (
    !isTestRecipientAllowed({
      email: input.email,
      requesterEmail: input.requesterEmail,
      guard,
    })
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Test reports can only go to your own address or an allowlisted one.",
    );
  }
  const { run, snapshot } = await loadPublishedRun(
    input.projectId,
    input.runId,
  );
  const profile = run.profileId
    ? await ReportDeliveryProfileRepository.getProfileById(run.profileId)
    : null;
  const { emailProvider } = await getReportProviders();
  const idempotencyKey = `report-test:${run.id}:${input.email}`;
  await ReportDeliveryRepository.insertDeliveries([
    {
      id: crypto.randomUUID(),
      runId: run.id,
      profileId: profile?.id ?? null,
      recipientId: null,
      email: input.email,
      name: null,
      idempotencyKey,
      isTest: true,
    },
  ]);
  const result = await emailProvider.send({
    to: { email: input.email, name: null },
    snapshot,
    branding: resolveReportBranding(profile),
    pdfStorageKey: await pdfStorageKeyFor(run.id),
    shareUrl: null,
    idempotencyKey,
  });
  const delivery = (await ReportDeliveryRepository.listDeliveries(run.id)).find(
    (row) => row.isTest && row.email === input.email,
  );
  if (delivery) {
    await ReportDeliveryRepository.recordDeliveryResult({
      deliveryId: delivery.id,
      status: result.status === "sent" ? "sent" : "failed",
      attempts: delivery.attempts + 1,
      providerMessageId:
        result.status === "sent" ? result.providerMessageId : null,
      errorMessage:
        result.status === "sent" ? null : describeSendFailure(result),
      sentAt: result.status === "sent" ? new Date().toISOString() : null,
    });
  }
  if (result.status !== "sent") {
    throw new AppError("INTERNAL_ERROR", describeSendFailure(result));
  }
  return { runId: run.id, email: input.email };
}

async function listDeliveries(input: { projectId: string; runId: string }) {
  const run = await ReportRepository.getRun(input.projectId, input.runId);
  if (!run) throw new AppError("NOT_FOUND", "Report not found.");
  const rows = await ReportDeliveryRepository.listDeliveries(run.id);
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    attempts: row.attempts,
    isTest: row.isTest,
    errorMessage: row.errorMessage,
    sentAt: row.sentAt,
  }));
}

export const ReportDeliveryService = {
  deliverRun,
  retryDeliveries,
  sendTestDelivery,
  listDeliveries,
};
