import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { AppError } from "@/server/lib/errors";

export const RANK_REPORT_RUN_LIMIT = 52;

export type Device = "desktop" | "mobile";

export type ReportSnapshotRow = Awaited<
  ReturnType<typeof RankTrackingRepository.getSnapshotsForRuns>
>[number];

export async function requireConfig(configId: string, projectId: string) {
  const config = await RankTrackingRepository.getConfigById({
    configId,
    projectId,
  });
  if (!config) {
    throw new AppError("INTERNAL_ERROR", "Rank tracking config not found");
  }
  return config;
}

export async function loadReportContext(configId: string, projectId: string) {
  const [config, keywords, runs] = await Promise.all([
    requireConfig(configId, projectId),
    RankTrackingRepository.getKeywordsForConfig(configId),
    RankTrackingRepository.getCompletedFullRuns(
      configId,
      RANK_REPORT_RUN_LIMIT,
    ),
  ]);
  const snapshots = await RankTrackingRepository.getSnapshotsForRuns(
    runs.map((run) => run.id),
  );
  return { config, keywords, runs, snapshots };
}

export function snapshotsForDevice(rows: ReportSnapshotRow[], device: Device) {
  return rows.filter((row) => row.device === device);
}

export function latestTwoRunIds(runs: Array<{ id: string }>): {
  currentRunId: string | null;
  previousRunId: string | null;
} {
  return {
    currentRunId: runs[0]?.id ?? null,
    previousRunId: runs[1]?.id ?? null,
  };
}

export function volumeByKeywordId(
  keywords: Array<{ id: string; searchVolume: number | null }>,
) {
  return new Map(keywords.map((keyword) => [keyword.id, keyword.searchVolume]));
}

export function capturedRunsForDevice(
  snapshots: ReportSnapshotRow[],
  runs: Array<{ id: string; startedAt: string }>,
  device: Device,
) {
  const captured = new Set(
    snapshots
      .filter((row) => row.device === device && row.serpCaptured)
      .map((row) => row.runId),
  );
  return runs.filter((run) => captured.has(run.id));
}
