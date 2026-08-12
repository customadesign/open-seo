import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Play, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createReportShareLink,
  createReportSchedule,
  createReportTemplate,
  deleteReportTemplate,
  getReportDashboard,
  retryReportRun,
  runReport,
} from "@/serverFunctions/reports";
import { REPORT_SECTION_KEYS } from "@/types/schemas/reports";

function reportPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 28);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

function confirmTemplateDeletion(name: string, onConfirm: () => void) {
  if (
    window.confirm(
      `Delete "${name}"? Existing report snapshots will stay available, and active schedules for this template will stop.`,
    )
  ) {
    onConfirm();
  }
}

function statusClass(status: string) {
  if (status === "completed") return "badge-success";
  if (status === "failed") return "badge-error";
  if (status === "sending" || status === "rendering") return "badge-info";
  return "badge-ghost";
}

function ReportsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6" aria-busy>
      <div className="skeleton h-9 w-48" />
      <div className="skeleton h-40" />
      <div className="skeleton h-56" />
    </div>
  );
}

export function ReportsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const dashboard = useQuery({
    queryKey: ["reports", projectId],
    queryFn: () => getReportDashboard({ data: { projectId } }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["reports", projectId] });

  const createTemplateMutation = useMutation({
    mutationFn: () =>
      createReportTemplate({
        data: {
          projectId,
          name: "Monthly SEO report",
          isDefault: true,
          sections: REPORT_SECTION_KEYS.map((key) => ({ key, enabled: true })),
        },
      }),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      deleteReportTemplate({ data: { projectId, templateId } }),
    onSuccess: () => {
      void refresh();
      toast.success("Report template deleted. Existing snapshots were kept.");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const runMutation = useMutation({
    mutationFn: (templateId: string) =>
      runReport({ data: { projectId, templateId, ...reportPeriod() } }),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const scheduleMutation = useMutation({
    mutationFn: (templateId: string) =>
      createReportSchedule({
        data: {
          projectId,
          templateId,
          name: "Monthly SEO report",
          frequency: "monthly",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          recipients: [],
        },
      }),
    onSuccess: () => {
      void refresh();
      toast.success("Monthly snapshot schedule created.");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const retryMutation = useMutation({
    mutationFn: (runId: string) =>
      retryReportRun({ data: { projectId, runId } }),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const shareMutation = useMutation({
    mutationFn: async (runId: string) => {
      const expires = new Date();
      expires.setUTCDate(expires.getUTCDate() + 7);
      return createReportShareLink({
        data: { projectId, runId, expiresAt: expires.toISOString() },
      });
    },
    onSuccess: async ({ token }) => {
      const url = `${window.location.origin}/api/reports/share/${token}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied. It expires in 7 days.");
      } catch {
        toast.info("Share link created. Copy it from the reports page.");
      }
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  if (dashboard.isPending) {
    return <ReportsLoading />;
  }
  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="px-4 py-6">
        <div className="alert alert-error">
          {getStandardErrorMessage(dashboard.error)}
        </div>
      </div>
    );
  }

  const { templates, schedules, runs, providers } = dashboard.data;
  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-base-content/70">
            Build repeatable snapshots from the SEO data already available for
            this project.
          </p>
        </div>

        {(providers.pdf === "unconfigured" ||
          providers.email === "unconfigured") && (
          <div className="alert alert-info text-sm">
            Snapshot reports are ready. PDF rendering and email delivery stay
            explicitly disabled until providers are configured.
          </div>
        )}

        {shareUrl && (
          <div className="alert alert-success text-sm">
            <span className="shrink-0">Share link:</span>
            <input
              className="input input-sm input-bordered w-full font-mono text-xs"
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Generated report share link"
            />
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Templates</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={createTemplateMutation.isPending}
              onClick={() => createTemplateMutation.mutate()}
            >
              <FileText className="size-4" />
              New starter template
            </button>
          </div>
          {templates.length === 0 ? (
            <div className="rounded-xl border border-base-300 bg-base-100 p-6 text-sm text-base-content/70">
              Create a starter template to generate your first report.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((template) => (
                <article
                  key={template.id}
                  className="rounded-xl border border-base-300 bg-base-100 p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">{template.name}</h3>
                      <p className="mt-1 text-xs text-base-content/60">
                        {template.sections
                          .filter((section) => section.isEnabled)
                          .map((section) => section.sectionKey)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {template.isDefault && (
                        <span className="badge badge-outline badge-sm">
                          Default
                        </span>
                      )}
                      {template.projectId === projectId && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm text-error"
                          aria-label={`Delete ${template.name}`}
                          disabled={
                            deleteTemplateMutation.isPending &&
                            deleteTemplateMutation.variables === template.id
                          }
                          onClick={() =>
                            confirmTemplateDeletion(template.name, () =>
                              deleteTemplateMutation.mutate(template.id),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={
                        runMutation.isPending ||
                        (deleteTemplateMutation.isPending &&
                          deleteTemplateMutation.variables === template.id)
                      }
                      onClick={() => runMutation.mutate(template.id)}
                    >
                      <Play className="size-4" />
                      Generate 28-day snapshot
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={
                        scheduleMutation.isPending ||
                        (deleteTemplateMutation.isPending &&
                          deleteTemplateMutation.variables === template.id) ||
                        schedules.some(
                          ({ schedule }) =>
                            schedule.templateId === template.id &&
                            schedule.frequency === "monthly" &&
                            schedule.isActive,
                        )
                      }
                      onClick={() => scheduleMutation.mutate(template.id)}
                    >
                      <CalendarClock className="size-4" />
                      Schedule monthly
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

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
                      <td>{recipients.length}</td>
                      <td>{schedule.nextRunAt ?? "Manual"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
                            disabled={shareMutation.isPending}
                            onClick={() => shareMutation.mutate(run.id)}
                          >
                            Copy share link
                          </button>
                        )}
                        {run.status === "failed" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={retryMutation.isPending}
                            onClick={() => retryMutation.mutate(run.id)}
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
      </div>
    </div>
  );
}
