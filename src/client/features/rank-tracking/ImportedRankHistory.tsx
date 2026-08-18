import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getRankHistorySourceMovement,
  getRankHistorySources,
} from "@/serverFunctions/rank-tracking";
import { buildCsv, downloadCsv } from "@/client/lib/csv";

type HistorySource = Awaited<ReturnType<typeof getRankHistorySources>>[number];

export function ImportedRankHistory({
  projectId,
  configId,
}: {
  projectId: string;
  configId: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: sources, isLoading } = useQuery({
    queryKey: ["rankHistorySources", projectId, configId],
    queryFn: () => getRankHistorySources({ data: { projectId, configId } }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-base-content/50">
        <Loader2 className="size-3.5 animate-spin" /> Loading imported history
      </div>
    );
  }
  if (!sources?.length) return null;

  return (
    <section className="mx-4 mb-4 rounded-lg border border-base-300">
      <div className="border-b border-base-300 px-3 py-2">
        <h3 className="text-sm font-medium">Imported SEMrush history</h3>
        <p className="text-xs text-base-content/55">
          Matching Google history continues into the live trend. Different
          locations and search engines stay separate so comparisons remain
          honest.
        </p>
      </div>
      <div className="divide-y divide-base-300">
        {sources.map((source) => (
          <HistorySourceRow
            key={source.id}
            source={source}
            projectId={projectId}
            configId={configId}
            expanded={expandedId === source.id}
            onToggle={() =>
              setExpandedId((current) =>
                current === source.id ? null : source.id,
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

function HistorySourceRow({
  source,
  projectId,
  configId,
  expanded,
  onToggle,
}: {
  source: HistorySource;
  projectId: string;
  configId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const movement = useQuery({
    queryKey: ["rankHistorySourceMovement", projectId, configId, source.id],
    queryFn: () =>
      getRankHistorySourceMovement({
        data: { projectId, configId, sourceId: source.id },
      }),
    enabled: expanded,
  });
  const rows = movement.data ?? [];
  const exportRows = () => {
    downloadCsv(
      `semrush-history-${source.externalCampaignId}.csv`,
      buildCsv(
        [
          "Keyword",
          "Device",
          "First date",
          "First position",
          "Last date",
          "Last position",
          "Change",
        ],
        rows.map((row) => [
          row.keyword,
          row.device,
          row.firstCheckedAt,
          row.firstPosition ?? "",
          row.lastCheckedAt,
          row.lastPosition ?? "",
          row.change ?? "",
        ]),
      ),
    );
  };

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">
            {formatEngine(source.searchEngine)} · {source.device}
          </p>
          <p className="truncate text-[11px] text-base-content/55">
            {source.sourceLocationName} · {formatDate(source.firstObservedAt)}–
            {formatDate(source.lastObservedAt)} · {Number(source.runCount)}{" "}
            checks
          </p>
        </div>
        <span
          className={`badge badge-sm ${
            source.continuity === "continuous"
              ? "badge-success badge-outline"
              : "badge-warning badge-outline"
          }`}
        >
          {source.continuity === "continuous" ? "In live trend" : "Legacy"}
        </span>
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-base-300 bg-base-200/20 px-3 py-3">
          {movement.isLoading ? (
            <Loader2 className="mx-auto size-4 animate-spin" />
          ) : rows.length === 0 ? (
            <p className="text-xs text-base-content/55">
              Campaign metadata is archived; no dated positions were returned.
            </p>
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={exportRows}
                >
                  <Download className="size-3" /> Export campaign CSV
                </button>
              </div>
              <div className="max-h-56 overflow-auto rounded border border-base-300 bg-base-100">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>First</th>
                      <th>Last</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((row) => (
                      <tr key={`${row.trackingKeywordId}:${row.device}`}>
                        <td>{row.keyword}</td>
                        <td>{row.firstPosition ?? "Not found"}</td>
                        <td>{row.lastPosition ?? "Not found"}</td>
                        <td
                          className={
                            row.change == null
                              ? ""
                              : row.change > 0
                                ? "text-success"
                                : row.change < 0
                                  ? "text-warning"
                                  : ""
                          }
                        >
                          {row.change == null
                            ? "—"
                            : row.change > 0
                              ? `+${row.change}`
                              : row.change}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function formatEngine(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
