import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import { ReportRepository } from "../repositories/ReportRepository";

async function recordExecution(input: {
  organizationId: string;
  projectId: string;
  runId: string;
  status: string;
  recovered?: boolean;
}) {
  if (input.status !== "failed" && !input.recovered) return;
  try {
    const scoped = await ReportRepository.getRunScoped({
      runId: input.runId,
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
    if (!scoped) return;
    const occurredAt =
      scoped.run.completedAt ??
      scoped.run.startedAt ??
      new Date().toISOString();
    if (input.recovered && input.status === "completed") {
      await ChangeEventService.record({
        projectId: input.projectId,
        source: "reports",
        eventType: "reports.recovered",
        severity: "opportunity",
        title: "Report retry succeeded",
        summary: `${scoped.template.name} completed after an earlier failure.`,
        entityType: "report_run",
        entityId: input.runId,
        sourceRunId: input.runId,
        dedupeKey: `report:${input.runId}:recovered`,
        occurredAt,
      });
      return;
    }
    await ChangeEventService.record({
      projectId: input.projectId,
      source: "reports",
      eventType: "reports.failed",
      severity: "warning",
      title: scoped.run.scheduleId
        ? "Scheduled report failed"
        : "Report generation failed",
      summary:
        `${scoped.template.name} did not complete${scoped.run.errorMessage ? `: ${scoped.run.errorMessage}` : "."}`.slice(
          0,
          1_000,
        ),
      entityType: "report_run",
      entityId: input.runId,
      sourceRunId: input.runId,
      dedupeKey: `report:${input.runId}:failed`,
      occurredAt,
    });
  } catch (error) {
    // Report state is authoritative. A secondary alert failure must not turn a
    // completed or failed report execution into a different result.
    console.error(
      `Report ${input.runId}: failed to record change event`,
      error,
    );
  }
}

export const ReportChangeEventService = { recordExecution } as const;
