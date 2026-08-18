/* eslint-disable max-lines -- report presentation follows the immutable snapshot union in one page module. */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  generateReport,
  getReport,
  getReportsDashboard,
  retryReport,
  saveReportCommentary,
  saveReportSettings,
} from "@/serverFunctions/reports";
import { REPORT_SECTION_LABELS as SECTION_LABELS } from "@/shared/report-sections";
import { type ReportSnapshot } from "@/types/schemas/reports";
import { ReportDeliveryProfilesPanel } from "./ReportDeliveryProfilesPanel";
import { ReportRunDeliveryCard } from "./ReportRunDeliveryCard";
import {
  aiAnswerShareLabel,
  coverageChange,
  freshnessLabel,
  sectionUnavailableLabel,
} from "./reportSectionUi";

export function ReportsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const accessQuery = useWorkspaceAccess();
  const canManage = accessQuery.data?.canUseProjectTools === true;
  const dashboardKey = ["reports", projectId];
  const dashboardQuery = useQuery({
    queryKey: dashboardKey,
    queryFn: () => getReportsDashboard({ data: { projectId } }),
    refetchInterval: (query) =>
      query.state.data?.runs.some(
        (run) => run.status === "queued" || run.status === "running",
      )
        ? 4_000
        : false,
  });
  const runs = React.useMemo(
    () => dashboardQuery.data?.runs ?? [],
    [dashboardQuery.data?.runs],
  );
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(runs[0]?.id ?? null);
  }, [runs, selectedRunId]);

  const generateMutation = useMutation({
    mutationFn: () => generateReport({ data: { projectId } }),
    onSuccess: async (result) => {
      setSelectedRunId(result.runId);
      await queryClient.invalidateQueries({ queryKey: dashboardKey });
      toast.success("Monthly report started");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="h-full overflow-auto bg-base-100">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 py-8 sm:p-6 md:py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <p className="mt-1 max-w-2xl text-sm text-base-content/60">
              Monthly search and advertising results, saved as a permanent
              snapshot for each period.
            </p>
          </div>
          {canManage ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Generate previous month
            </button>
          ) : null}
        </header>

        {canManage && dashboardQuery.data ? (
          <>
            <ReportSettingsPanel
              projectId={projectId}
              settings={dashboardQuery.data.settings}
              onSaved={() =>
                queryClient.invalidateQueries({ queryKey: dashboardKey })
              }
            />
            <ReportDeliveryProfilesPanel projectId={projectId} />
          </>
        ) : null}

        {dashboardQuery.isLoading ? (
          <div className="grid min-h-64 place-items-center">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : dashboardQuery.isError ? (
          <div className="alert alert-error text-sm">
            Could not load reports.
          </div>
        ) : runs.length === 0 ? (
          <EmptyState canManage={canManage} />
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <ReportRunList
              runs={runs}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
            />
            {selectedRunId ? (
              <div className="space-y-5">
                <ReportDetail
                  projectId={projectId}
                  runId={selectedRunId}
                  canManage={canManage}
                  onChanged={() =>
                    queryClient.invalidateQueries({ queryKey: dashboardKey })
                  }
                />
                {canManage &&
                runs.find((run) => run.id === selectedRunId)?.status ===
                  "published" ? (
                  <ReportRunDeliveryCard
                    projectId={projectId}
                    runId={selectedRunId}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

type Dashboard = Awaited<ReturnType<typeof getReportsDashboard>>;

function ReportSettingsPanel({
  projectId,
  settings,
  onSaved,
}: {
  projectId: string;
  settings: Dashboard["settings"];
  onSaved: () => Promise<unknown>;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(settings);
  React.useEffect(() => setDraft(settings), [settings]);
  const mutation = useMutation({
    mutationFn: () => saveReportSettings({ data: { projectId, ...draft } }),
    onSuccess: async () => {
      await onSaved();
      toast.success("Report settings saved");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft.sections];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, sections: next });
  };
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2.5">
          <CalendarClock className="size-5 text-primary" />
          <span>
            <span className="block text-sm font-semibold">
              Monthly schedule
            </span>
            <span className="block text-xs text-base-content/55">
              {settings.isEnabled
                ? `Runs on day ${settings.runDay} at ${String(settings.runHour).padStart(2, "0")}:00 ${settings.timeZone}`
                : "Automatic publishing is off"}
            </span>
          </span>
        </span>
        <span className="text-xs text-base-content/50">
          {open ? "Close" : "Configure"}
        </span>
      </button>
      {open ? (
        <div className="space-y-5 border-t border-base-300 p-4 sm:p-5">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={draft.isEnabled}
              onChange={(event) =>
                setDraft({ ...draft, isEnabled: event.target.checked })
              }
            />
            Publish a report automatically each month
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Day of month</span>
              <input
                className="input input-bordered input-sm w-full"
                type="number"
                min={1}
                max={28}
                value={draft.runDay}
                onChange={(event) =>
                  setDraft({ ...draft, runDay: Number(event.target.value) })
                }
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Hour</span>
              <input
                className="input input-bordered input-sm w-full"
                type="number"
                min={0}
                max={23}
                value={draft.runHour}
                onChange={(event) =>
                  setDraft({ ...draft, runHour: Number(event.target.value) })
                }
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Timezone</span>
              <input
                className="input input-bordered input-sm w-full"
                value={draft.timeZone}
                onChange={(event) =>
                  setDraft({ ...draft, timeZone: event.target.value })
                }
                placeholder="America/Chicago"
              />
            </label>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Report sections</p>
            <div className="divide-y divide-base-300 rounded-lg border border-base-300">
              {draft.sections.map((section, index) => (
                <div
                  key={section.key}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={section.enabled}
                    onChange={(event) => {
                      const next = [...draft.sections];
                      next[index] = {
                        ...section,
                        enabled: event.target.checked,
                      };
                      setDraft({ ...draft, sections: next });
                    }}
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    {SECTION_LABELS[section.key]}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Move section up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    disabled={index === draft.sections.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Move section down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReportRunList({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Dashboard["runs"];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <div className="border-b border-base-300 px-4 py-3 text-sm font-semibold">
        Report history
      </div>
      <div className="max-h-[38rem] divide-y divide-base-300 overflow-auto">
        {runs.map((run) => (
          <button
            type="button"
            key={run.id}
            className={`block w-full px-4 py-3 text-left transition hover:bg-base-200/60 ${selectedRunId === run.id ? "bg-primary/8" : ""}`}
            onClick={() => onSelect(run.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {formatMonth(run.periodStart)}
              </span>
              <StatusPill status={run.status} />
            </div>
            <p className="mt-1 text-xs text-base-content/50">
              {run.periodStart} to {run.periodEnd}
            </p>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ReportDetail({
  projectId,
  runId,
  canManage,
  onChanged,
}: {
  projectId: string;
  runId: string;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const detailKey = ["report", projectId, runId];
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => getReport({ data: { projectId, runId } }),
    refetchInterval: (query) =>
      query.state.data?.status === "queued" ||
      query.state.data?.status === "running"
        ? 3_000
        : false,
  });
  const retryMutation = useMutation({
    mutationFn: () => retryReport({ data: { projectId, runId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailKey }),
        onChanged(),
      ]);
      toast.success("Report retry started");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  if (detailQuery.isLoading) {
    return (
      <div className="grid min-h-64 place-items-center">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }
  if (!detailQuery.data)
    return (
      <div className="alert alert-error text-sm">
        Could not load this report.
      </div>
    );
  const detail = detailQuery.data;
  if (!detail.snapshot) {
    return (
      <div className="rounded-xl border border-base-300 bg-base-100 p-8 text-center shadow-sm">
        {detail.status === "failed" ? (
          <>
            <h2 className="font-semibold">Report generation failed</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-base-content/60">
              {detail.errorMessage ??
                "A connected data source could not be read."}
            </p>
            {canManage ? (
              <button
                type="button"
                className="btn btn-outline btn-sm mt-4"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate()}
              >
                <RefreshCw className="size-4" /> Retry report
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className="loading loading-spinner loading-md" />
            <h2 className="mt-3 font-semibold">Building the report</h2>
            <p className="mt-1 text-sm text-base-content/60">
              Connected sources are being collected and compared.
            </p>
          </>
        )}
      </div>
    );
  }
  return (
    <article className="min-w-0 space-y-5">
      <div className="rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Monthly performance report
            </p>
            <h2 className="mt-1 text-2xl font-bold">
              {formatMonth(detail.periodStart)}
            </h2>
            <p className="mt-1 text-sm text-base-content/55">
              {detail.periodStart} to {detail.periodEnd}
            </p>
          </div>
          <StatusPill status={detail.status} />
        </div>
      </div>
      <ExecutiveSummary
        projectId={projectId}
        runId={runId}
        items={detail.commentary}
        canManage={canManage}
        onSaved={() => queryClient.invalidateQueries({ queryKey: detailKey })}
      />
      {detail.snapshot.sections.map((section) => (
        <ReportSection key={section.key} section={section} />
      ))}
      {detail.snapshot.omissions.filter((item) => item.reason !== "disabled")
        .length > 0 ? (
        <div className="rounded-lg border border-base-300 px-4 py-3 text-xs text-base-content/55">
          Not included:{" "}
          {detail.snapshot.omissions
            .filter((item) => item.reason !== "disabled")
            .map(
              (item) =>
                `${SECTION_LABELS[item.key]} (${item.reason === "not_configured" ? "not connected" : "no data"})`,
            )
            .join(", ")}
          .
        </div>
      ) : null}
    </article>
  );
}

type CommentaryItem = Awaited<
  ReturnType<typeof getReport>
>["commentary"][number];

function ExecutiveSummary({
  projectId,
  runId,
  items,
  canManage,
  onSaved,
}: {
  projectId: string;
  runId: string;
  items: CommentaryItem[];
  canManage: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(items);
  React.useEffect(() => setDraft(items), [items]);
  const mutation = useMutation({
    mutationFn: () =>
      saveReportCommentary({
        data: {
          projectId,
          runId,
          items: draft.map(({ kind, text, evidenceKey }) => ({
            kind,
            text,
            evidenceKey,
          })),
        },
      }),
    onSuccess: async () => {
      await onSaved();
      setEditing(false);
      toast.success("Summary updated");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Executive summary</h3>
        {canManage ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {draft.map((item, index) => (
          <div
            key={`${item.kind}:${index}`}
            className="rounded-lg bg-base-200/50 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-base-content/45">
              {commentaryLabel(item.kind)}
            </p>
            {editing ? (
              <textarea
                className="textarea textarea-bordered mt-2 min-h-24 w-full bg-base-100 text-sm"
                value={item.text}
                maxLength={2_000}
                onChange={(event) => {
                  const next = [...draft];
                  next[index] = { ...item, text: event.target.value };
                  setDraft(next);
                }}
              />
            ) : (
              <p className="mt-1 text-sm leading-6 text-base-content/75">
                {item.text}
              </p>
            )}
          </div>
        ))}
      </div>
      {editing ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={
              mutation.isPending || draft.some((item) => !item.text.trim())
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Save summary"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

type SnapshotSection = ReportSnapshot["sections"][number];

function ReportSection({ section }: { section: SnapshotSection }) {
  if (section.key === "rankings")
    return <RankingsSection data={section.data} />;
  if (section.key === "gsc") return <GscSection data={section.data} />;
  if (section.key === "ga4") return <Ga4Section data={section.data} />;
  if (section.key === "google_ads")
    return <GoogleAdsSection data={section.data} />;
  if (section.key === "audit") return <AuditSection data={section.data} />;
  if (section.key === "backlinks")
    return <BacklinksSection data={section.data} />;
  if (section.key === "ai_visibility")
    return <AiVisibilitySection data={section.data} />;
  return <LocalGeoGridSection data={section.data} />;
}

function UnavailableList({
  items,
}: {
  items: Array<{ configId: string; label: string; reason: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
      <p className="text-xs font-semibold uppercase text-base-content/60">
        No data for this period
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.configId}>
            <span className="font-medium">{item.label}</span> —{" "}
            {sectionUnavailableLabel(item.reason)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiVisibilitySection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "ai_visibility" }>["data"];
}) {
  return (
    <SectionShell title="AI visibility">
      {data.configs.map((config) => (
        <div key={config.configId} className="space-y-4">
          <div>
            <p className="font-medium">{config.brandName}</p>
            <p className="text-xs text-base-content/50">
              {config.domain} · {freshnessLabel(config.freshness)}
            </p>
          </div>
          <MetricGrid
            metrics={[
              {
                label: "Answers mentioning brand",
                current: config.summary.brandMentioned,
                change: coverageChange(
                  config.summary.brandMentioned,
                  config.previous?.brandMentioned,
                ),
              },
              {
                label: "Answers citing domain",
                current: config.summary.domainCited,
                change: coverageChange(
                  config.summary.domainCited,
                  config.previous?.domainCited,
                ),
              },
              { label: "Total mentions", current: config.summary.mentionTotal },
              {
                label: "Prompts unavailable",
                current: config.summary.unavailable,
              },
            ]}
          />
          <p className="text-sm text-base-content/70">
            {aiAnswerShareLabel(config.summary)}
          </p>
          <DataTable
            headers={[
              "Provider",
              "Mentioned",
              "Absent",
              "Unavailable",
              "Cited domain",
              "Share of answers",
            ]}
            rows={config.providers.map((provider) => [
              humanize(provider.provider),
              provider.brandMentioned,
              provider.brandAbsent,
              provider.unavailable,
              provider.domainCited,
              aiAnswerShareLabel(provider),
            ])}
          />
        </div>
      ))}
      <UnavailableList
        items={data.unavailable.map((item) => ({
          configId: item.configId,
          label: item.brandName,
          reason: item.reason,
        }))}
      />
    </SectionShell>
  );
}

function LocalGeoGridSection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "local_geo_grid" }>["data"];
}) {
  return (
    <SectionShell title="Local map rankings">
      {data.configs.map((config) => (
        <div key={config.configId} className="space-y-4">
          <div>
            <p className="font-medium">
              {config.keyword} · {config.businessName}
            </p>
            <p className="text-xs text-base-content/50">
              {config.gridSize}×{config.gridSize} grid ·{" "}
              {Math.round(config.radiusMeters / 1000)} km · {config.device} ·{" "}
              {freshnessLabel(config.freshness)}
            </p>
          </div>
          <MetricGrid
            metrics={[
              {
                label: "Average rank",
                current: config.summary.averageRank,
                // Lower is better, so an improvement reads as a negative
                // change here; the coverage tiles carry the plain direction.
                change: coverageChange(
                  config.summary.averageRank,
                  config.previous?.averageRank,
                ),
              },
              {
                label: "Top 3 coverage",
                current: config.summary.topThreeCoverage,
                change: coverageChange(
                  config.summary.topThreeCoverage,
                  config.previous?.topThreeCoverage,
                ),
                format: "percent",
              },
              {
                label: "Top 10 coverage",
                current: config.summary.topTenCoverage,
                change: coverageChange(
                  config.summary.topTenCoverage,
                  config.previous?.topTenCoverage,
                ),
                format: "percent",
              },
              {
                label: "Grid points ranked",
                current: config.summary.rankedCells,
              },
            ]}
          />
          <p className="text-sm text-base-content/70">
            {config.summary.rankedCells} of {config.summary.cellsCompleted}{" "}
            scanned grid points returned this business.
          </p>
        </div>
      ))}
      <UnavailableList
        items={data.unavailable.map((item) => ({
          configId: item.configId,
          label: item.keyword,
          reason: item.reason,
        }))}
      />
    </SectionShell>
  );
}

function SectionShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <h3 className="border-b border-base-300 px-5 py-4 text-lg font-semibold sm:px-6">
        {title}
      </h3>
      <div className="space-y-5 p-5 sm:p-6">{children}</div>
    </section>
  );
}

function MetricGrid({
  metrics,
}: {
  metrics: Array<{
    label: string;
    current: number | null;
    change?: number | null;
    format?: "number" | "percent" | "money";
    currency?: string;
  }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border border-base-300 p-4"
        >
          <p className="text-xs text-base-content/50">{metric.label}</p>
          <p className="mt-1 text-xl font-bold">
            {formatMetric(metric.current, metric.format, metric.currency)}
          </p>
          {metric.change != null ? (
            <p
              className={`mt-1 text-xs ${metric.change > 0 ? "text-success" : metric.change < 0 ? "text-error" : "text-base-content/45"}`}
            >
              {metric.change > 0 ? "+" : ""}
              {formatMetric(metric.change, metric.format, metric.currency)} vs
              prior period
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RankingsSection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "rankings" }>["data"];
}) {
  return (
    <SectionShell title="Keyword rankings">
      {data.configs.map((config) => (
        <div key={config.configId} className="space-y-4">
          <div>
            <p className="font-medium">{config.domain}</p>
            <p className="text-xs text-base-content/50">
              {config.locationName ?? "National"} · {config.devices}
            </p>
          </div>
          <MetricGrid
            metrics={[
              { label: "Tracked", current: config.summary.tracked },
              { label: "Top 3", current: config.summary.top3 },
              { label: "Top 10", current: config.summary.top10 },
              { label: "Improved", current: config.summary.improved },
            ]}
          />
          <DataTable
            headers={["Keyword", "Device", "Position", "Previous", "Change"]}
            rows={config.rows
              .slice(0, 50)
              .map((row) => [
                row.keyword,
                row.device,
                row.position ?? "Not found",
                row.previousPosition ?? "—",
                row.change == null
                  ? "—"
                  : row.change > 0
                    ? `+${row.change}`
                    : String(row.change),
              ])}
          />
          {config.distribution ? (
            <div>
              <h4 className="mb-2 text-sm font-semibold">
                Rankings distribution
              </h4>
              <DataTable
                headers={["Band", "Now", "Entered", "Left"]}
                rows={[
                  [
                    "1–3",
                    config.distribution.current.top3,
                    config.distribution.movement.top3.entered,
                    config.distribution.movement.top3.left,
                  ],
                  [
                    "4–10",
                    config.distribution.current.top4to10,
                    config.distribution.movement.top4to10.entered,
                    config.distribution.movement.top4to10.left,
                  ],
                  [
                    "11–20",
                    config.distribution.current.top11to20,
                    config.distribution.movement.top11to20.entered,
                    config.distribution.movement.top11to20.left,
                  ],
                  [
                    "21–100",
                    config.distribution.current.top21to100,
                    config.distribution.movement.top21to100.entered,
                    config.distribution.movement.top21to100.left,
                  ],
                  [
                    "Out of top 100",
                    config.distribution.current.notInTop100,
                    config.distribution.movement.notInTop100.entered,
                    config.distribution.movement.notInTop100.left,
                  ],
                ]}
              />
            </div>
          ) : null}
          {config.cannibalization &&
          config.cannibalization.findings.length > 0 ? (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Cannibalization</h4>
              <DataTable
                headers={["Keyword", "Device", "Position", "URLs", "Flips"]}
                rows={config.cannibalization.findings
                  .slice(0, 20)
                  .map((row) => [
                    row.keyword,
                    row.device,
                    row.currentPosition ?? "—",
                    row.competingUrls.length,
                    row.transitionCount,
                  ])}
              />
            </div>
          ) : null}
        </div>
      ))}
    </SectionShell>
  );
}

function GscSection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "gsc" }>["data"];
}) {
  return (
    <SectionShell title="Google Search Console">
      <MetricGrid
        metrics={[
          { label: "Clicks", ...data.metrics.clicks },
          { label: "Impressions", ...data.metrics.impressions },
          { label: "CTR", ...data.metrics.ctr, format: "percent" },
          { label: "Average position", ...data.metrics.position },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">Top queries</h4>
          <DataTable
            headers={["Query", "Clicks", "Impressions", "Position"]}
            rows={data.topQueries
              .slice(0, 15)
              .map((row) => [
                row.query,
                row.clicks,
                row.impressions,
                row.position.toFixed(1),
              ])}
          />
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Top pages</h4>
          <DataTable
            headers={["Page", "Clicks", "Impressions", "Position"]}
            rows={data.topPages
              .slice(0, 15)
              .map((row) => [
                shortPath(row.page),
                row.clicks,
                row.impressions,
                row.position.toFixed(1),
              ])}
          />
        </div>
      </div>
      {data.opportunities.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            Striking-distance opportunities
          </h4>
          <DataTable
            headers={["Query", "Page", "Impressions", "Position"]}
            rows={data.opportunities.map((row) => [
              row.query,
              shortPath(row.page),
              row.impressions,
              row.position.toFixed(1),
            ])}
          />
        </div>
      ) : null}
    </SectionShell>
  );
}

function Ga4Section({
  data,
}: {
  data: Extract<SnapshotSection, { key: "ga4" }>["data"];
}) {
  const metric = (key: string) =>
    data.metrics[key] ?? { current: null, change: null };
  return (
    <SectionShell title="Google Analytics">
      <MetricGrid
        metrics={[
          { label: "Organic sessions", ...metric("sessions") },
          { label: "Active users", ...metric("activeUsers") },
          { label: "Key events", ...metric("keyEvents") },
          {
            label: "Revenue",
            ...metric("purchaseRevenue"),
            format: "money",
            currency: data.currencyCode,
          },
        ]}
      />
      <h4 className="text-sm font-semibold">Top organic landing pages</h4>
      <DataTable
        headers={["Landing page", "Sessions", "Users", "Key events"]}
        rows={data.topLandingPages
          .slice(0, 20)
          .map((row) => [
            String(row.landingPage ?? row.pagePath ?? "—"),
            Number(row.sessions ?? 0),
            Number(row.activeUsers ?? 0),
            Number(row.keyEvents ?? 0),
          ])}
      />
    </SectionShell>
  );
}

function GoogleAdsSection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "google_ads" }>["data"];
}) {
  return (
    <SectionShell title="Google Ads">
      <p className="text-xs text-base-content/50">
        {data.customerName} · {formatCustomerId(data.customerId)}
      </p>
      <MetricGrid
        metrics={[
          {
            label: "Spend",
            ...data.metrics.cost,
            format: "money",
            currency: data.currencyCode,
          },
          { label: "Clicks", ...data.metrics.clicks },
          { label: "Conversions", ...data.metrics.conversions },
          {
            label: "Cost per conversion",
            ...data.metrics.costPerConversion,
            format: "money",
            currency: data.currencyCode,
          },
          {
            label: "Conversion value",
            ...data.metrics.conversionValue,
            format: "money",
            currency: data.currencyCode,
          },
          { label: "ROAS", ...data.metrics.roas },
        ]}
      />
      <h4 className="text-sm font-semibold">Campaigns</h4>
      <DataTable
        headers={[
          "Campaign",
          "Spend",
          "Clicks",
          "Conversions",
          "Cost / conversion",
        ]}
        rows={data.campaigns.map((row) => [
          row.name,
          formatMetric(row.cost, "money", data.currencyCode),
          row.clicks,
          row.conversions.toFixed(1),
          formatMetric(row.costPerConversion, "money", data.currencyCode),
        ])}
      />
    </SectionShell>
  );
}

function AuditSection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "audit" }>["data"];
}) {
  return (
    <SectionShell title="Site audit">
      <MetricGrid
        metrics={[
          { label: "Pages crawled", current: data.pagesCrawled },
          {
            label: "Critical findings",
            current: data.issues
              .filter((issue) => issue.severity === "critical")
              .reduce((sum, issue) => sum + issue.affectedPages, 0),
          },
          {
            label: "Warnings",
            current: data.issues
              .filter((issue) => issue.severity === "warning")
              .reduce((sum, issue) => sum + issue.affectedPages, 0),
          },
        ]}
      />
      <DataTable
        headers={["Issue", "Severity", "Affected pages"]}
        rows={data.issues.map((issue) => [
          humanize(issue.issueType),
          issue.severity,
          issue.affectedPages,
        ])}
      />
    </SectionShell>
  );
}

function BacklinksSection({
  data,
}: {
  data: Extract<SnapshotSection, { key: "backlinks" }>["data"];
}) {
  return (
    <SectionShell title="Backlinks">
      <MetricGrid
        metrics={[
          { label: "Domain rank", current: data.domainRank },
          { label: "Backlinks", current: data.backlinks },
          { label: "Referring domains", current: data.referringDomains },
          { label: "New backlinks", current: data.newBacklinks },
          { label: "Lost backlinks", current: data.lostBacklinks },
        ]}
      />
    </SectionShell>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-base-300">
      <table className="table table-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={
                    cellIndex === 0 ? "max-w-xs truncate" : "whitespace-nowrap"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ canManage }: { canManage: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-base-300 p-12 text-center">
      <CalendarClock className="mx-auto size-8 text-base-content/35" />
      <h2 className="mt-3 font-semibold">No monthly reports yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-base-content/55">
        {canManage
          ? "Generate the previous month now, or turn on the monthly schedule above."
          : "Your reports will appear here after they are published."}
      </p>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: Dashboard["runs"][number]["status"];
}) {
  const classes =
    status === "published"
      ? "badge-success"
      : status === "failed"
        ? "badge-error"
        : "badge-warning";
  return <span className={`badge badge-sm ${classes}`}>{status}</span>;
}

function formatMonth(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatMetric(
  value: number | null,
  format: "number" | "percent" | "money" = "number",
  currency = "USD",
) {
  if (value == null) return "—";
  if (format === "percent")
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  if (format === "money")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}

function commentaryLabel(kind: CommentaryItem["kind"]) {
  return {
    overview: "Overview",
    win: "What improved",
    watch: "What to watch",
    next_step: "Next step",
  }[kind];
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function shortPath(value: string) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return value;
  }
}

function formatCustomerId(value: string) {
  return value.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
}
