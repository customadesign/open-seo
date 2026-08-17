import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";

/**
 * Report health belongs in the project's change feed: a silent scheduled
 * failure is the failure mode that actually loses a client.
 */
async function recordRunFailed(input: {
  projectId: string;
  runId: string;
  trigger: "manual" | "scheduled";
  errorMessage: string;
  occurredAt?: string;
}) {
  await ChangeEventService.recordSafely({
    projectId: input.projectId,
    source: "reports",
    eventType: "reports.failed",
    severity: input.trigger === "scheduled" ? "warning" : "info",
    title:
      input.trigger === "scheduled"
        ? "Scheduled report failed"
        : "Report generation failed",
    summary: input.errorMessage,
    entityType: "report_run",
    entityId: input.runId,
    sourceRunId: input.runId,
    dedupeKey: `report:${input.runId}:failed`,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
}

async function recordRunRecovered(input: {
  projectId: string;
  runId: string;
  occurredAt?: string;
}) {
  await ChangeEventService.recordSafely({
    projectId: input.projectId,
    source: "reports",
    eventType: "reports.recovered",
    severity: "opportunity",
    title: "Report retry succeeded",
    summary: "The report completed after an earlier failure.",
    entityType: "report_run",
    entityId: input.runId,
    sourceRunId: input.runId,
    dedupeKey: `report:${input.runId}:recovered`,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
}

export const ReportChangeEventService = { recordRunFailed, recordRunRecovered };
