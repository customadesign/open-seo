import { useQuery } from "@tanstack/react-query";
import { getRankCheckRuns } from "@/serverFunctions/rank-tracking";
import { parseDbTimestampMs } from "@/shared/db-timestamps";
import { EmptyState, LoadingState } from "./RankTrackingReportUi";

type CheckRun = Awaited<ReturnType<typeof getRankCheckRuns>>[number];

const STATUS_BADGE: Record<CheckRun["status"], string> = {
  completed: "badge-success",
  failed: "badge-error",
  running: "badge-info",
  pending: "badge-ghost",
};

function formatStartedAt(value: string): string {
  const ms = parseDbTimestampMs(value);
  return ms == null ? value : new Date(ms).toLocaleString();
}

function formatDuration(run: CheckRun): string {
  if (!run.completedAt) return "—";
  const start = parseDbTimestampMs(run.startedAt);
  const end = parseDbTimestampMs(run.completedAt);
  if (start == null || end == null) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RankCheckLogPanel({
  projectId,
  configId,
}: {
  projectId: string;
  configId: string;
}) {
  const { data: runs, isLoading } = useQuery({
    queryKey: ["rankCheckRuns", projectId, configId],
    queryFn: () => getRankCheckRuns({ data: { projectId, configId } }),
  });

  if (isLoading) return <LoadingState />;
  if (!runs || runs.length === 0) {
    return (
      <EmptyState>
        No checks yet. Each time Check rankings runs, it is logged here.
      </EmptyState>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Checked</th>
            <th>Status</th>
            <th>Keywords</th>
            <th>Duration</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="align-top whitespace-nowrap">
                {formatStartedAt(run.startedAt)}
              </td>
              <td className="align-top">
                <span className={`badge badge-sm ${STATUS_BADGE[run.status]}`}>
                  {run.status}
                </span>
              </td>
              <td className="align-top whitespace-nowrap">
                {run.keywordsChecked} / {run.keywordsTotal}
                {run.isSubsetRun && (
                  <span className="text-base-content/50"> · selected</span>
                )}
              </td>
              <td className="align-top">{formatDuration(run)}</td>
              <td className="align-top text-xs text-error">
                {run.errorMessage}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
