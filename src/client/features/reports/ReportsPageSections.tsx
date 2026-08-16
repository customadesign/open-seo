import { RefreshCw } from "lucide-react";

type ScheduleRow = {
  schedule: {
    id: string;
    name: string;
    frequency: string;
    nextRunAt: string | null;
  };
  recipients: Array<{ email: string }>;
};

type RunRow = {
  run: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: string;
  };
  templateName: string;
};

function statusClass(status: string) {
  if (status === "completed") return "badge-success";
  if (status === "failed") return "badge-error";
  if (status === "sending" || status === "rendering") return "badge-info";
  return "badge-ghost";
}

export function ReportSchedulesSection({
  schedules,
}: {
  schedules: ScheduleRow[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Schedules</h2>
      {schedules.length === 0 ? (
        <p className="text-sm text-base-content/60">No schedules yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Frequency</th>
                <th>Recipients</th>
                <th>Next run</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(({ schedule, recipients }) => (
                <tr key={schedule.id}>
                  <td>{schedule.name}</td>
                  <td className="capitalize">{schedule.frequency}</td>
                  <td>
                    {recipients.length === 0
                      ? "Snapshot only"
                      : recipients
                          .map((recipient) => recipient.email)
                          .join(", ")}
                  </td>
                  <td>{schedule.nextRunAt ?? "Manual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ReportRunsSection({
  runs,
  sharePending,
  retryPending,
  onShare,
  onRetry,
}: {
  runs: RunRow[];
  sharePending: boolean;
  retryPending: boolean;
  onShare: (runId: string) => void;
  onRetry: (runId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Recent runs</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No reports generated yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Template</th>
                <th>Period</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, templateName }) => (
                <tr key={run.id}>
                  <td>{templateName}</td>
                  <td className="text-xs">
                    {run.periodStart.slice(0, 10)} –{" "}
                    {run.periodEnd.slice(0, 10)}
                  </td>
                  <td>
                    <span
                      className={`badge badge-sm ${statusClass(run.status)}`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="text-right">
                    {run.status === "completed" && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={sharePending}
                        onClick={() => onShare(run.id)}
                      >
                        Copy share link
                      </button>
                    )}
                    {run.status === "failed" && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={retryPending}
                        onClick={() => onRetry(run.id)}
                      >
                        <RefreshCw className="size-3.5" /> Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
