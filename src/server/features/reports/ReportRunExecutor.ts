import { reportSnapshotSchema } from "@/types/schemas/reports";
import { generateReportCommentary } from "./ReportCommentaryService";
import { assembleReportSnapshot } from "./ReportSnapshotAssembler";
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
  await ReportRepository.setRunRunning(input.runId, input.workflowInstanceId);
  try {
    const sectionRows = await ReportRepository.getSections(settings.id);
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
    const commentary = await generateReportCommentary(snapshot);
    await ReportRepository.publishRun({
      runId: input.runId,
      snapshotJson: JSON.stringify(snapshot),
      commentary,
    });
    return { status: "published" as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Report generation failed";
    await ReportRepository.failRun(input.runId, message);
    throw error;
  }
}
