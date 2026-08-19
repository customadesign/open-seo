import { reportSnapshotSchema } from "@/types/schemas/reports";
import { generateReportCommentary } from "./ReportCommentaryService";
import { ReportChangeEventService } from "./ReportChangeEventService";
import { assembleReportSnapshot } from "./ReportSnapshotAssembler";
import { ReportDeliveryProfileRepository } from "./repositories/ReportDeliveryProfileRepository";
import { ReportRepository } from "./repositories/ReportRepository";

export async function executeReportRun(input: {
  projectId: string;
  runId: string;
  workflowInstanceId?: string;
}) {
  const run = await ReportRepository.getRun(input.projectId, input.runId);
  if (!run) throw new Error("Report run not found");
  if (run.status === "published") return { status: "published" as const };
  const settings = await ReportRepository.getSettings(input.projectId);
  if (!settings || settings.id !== run.settingsId) {
    throw new Error("Report settings not found");
  }
  const wasFailed = run.status === "failed";
  await ReportRepository.setRunRunning(input.runId, input.workflowInstanceId);
  try {
    // A delivery profile owns its own section selection; project settings are
    // the fallback for manual and legacy monthly runs.
    const sectionRows = run.profileId
      ? await ReportDeliveryProfileRepository.getProfileSections(run.profileId)
      : await ReportRepository.getSections(settings.id);
    const snapshot = reportSnapshotSchema.parse(
      await assembleReportSnapshot({
        projectId: input.projectId,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        compareStart: run.compareStart,
        compareEnd: run.compareEnd,
        sections: sectionRows.map((section) => ({
          key: section.sectionKey,
          enabled: section.isEnabled,
        })),
      }),
    );
    const commentary = await generateReportCommentary(snapshot, {
      organizationId: settings.organizationId,
      projectId: input.projectId,
      runId: run.id,
      trigger: run.trigger,
    });
    await ReportRepository.publishRun({
      runId: input.runId,
      snapshotJson: JSON.stringify(snapshot),
      commentary,
    });
    if (wasFailed) {
      await ReportChangeEventService.recordRunRecovered({
        projectId: input.projectId,
        runId: input.runId,
      });
    }
    return { status: "published" as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Report generation failed";
    await ReportRepository.failRun(input.runId, message);
    await ReportChangeEventService.recordRunFailed({
      projectId: input.projectId,
      runId: input.runId,
      trigger: run.trigger,
      errorMessage: message,
    });
    throw error;
  }
}
