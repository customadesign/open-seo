import { useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import {
  AppDataTable,
  useAppTable,
} from "@/client/components/table/AppDataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import type { TrafficInsightsPage } from "@/server/features/traffic-insights/services/OrganicTrafficInsightsService";

const helper = createColumnHelper<TrafficInsightsPage>();
const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

function formatMissing(
  value: number | null,
  format: (value: number) => string,
) {
  return value == null ? "—" : format(value);
}

function buildColumns() {
  return [
    helper.accessor("url", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Landing page" />
      ),
      cell: ({ getValue }) => (
        <span className="block max-w-xl truncate" title={getValue()}>
          {getValue()}
        </span>
      ),
    }),
    helper.accessor("sessions", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Sessions" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCount),
      sortingFn: "basic",
      meta: rightAligned,
    }),
    helper.accessor("engagementRate", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Engagement" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCtr),
      meta: rightAligned,
    }),
    helper.accessor("keyEvents", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Key events" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCount),
      meta: rightAligned,
    }),
    helper.accessor("clicks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCount),
      meta: rightAligned,
    }),
    helper.accessor("impressions", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCount),
      meta: rightAligned,
    }),
    helper.accessor("ctr", {
      header: ({ column }) => (
        <SortableHeader column={column} label="CTR" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCtr),
      meta: rightAligned,
    }),
    helper.accessor("averagePosition", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Avg. position" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatPosition),
      meta: rightAligned,
    }),
    helper.accessor("keywordCount", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Keywords" align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatCount),
      meta: rightAligned,
    }),
    helper.accessor("bestPosition", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Best pos." align="right" />
      ),
      cell: ({ getValue }) => formatMissing(getValue(), formatPosition),
      meta: rightAligned,
    }),
  ];
}

export function TrafficInsightsTable({
  rows,
}: {
  rows: TrafficInsightsPage[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const columns = useMemo(() => buildColumns(), []);
  const table = useAppTable({
    data: rows,
    columns,
    withSorting: true,
    getRowId: (row) => row.key,
    initialState: { sorting: [{ id: "sessions", desc: true }] },
  });
  const selected = rows.find((row) => row.key === selectedKey);

  return (
    <div>
      <AppDataTable
        table={table}
        className="table table-zebra table-sm"
        wrapperClassName="overflow-x-auto"
        getRowProps={(row) => ({
          onClick: () =>
            setSelectedKey((current) =>
              current === row.original.key ? null : row.original.key,
            ),
          className: "cursor-pointer",
        })}
        getRowClassName={(row) =>
          row.original.key === selectedKey ? "bg-base-200" : undefined
        }
        empty={
          <p className="p-6 text-sm text-base-content/60">
            No landing pages in the connected sources for this period.
          </p>
        }
      />
      {selected ? <PageDetail row={selected} /> : null}
    </div>
  );
}

function PageDetail({ row }: { row: TrafficInsightsPage }) {
  return (
    <div className="grid gap-4 border-t border-base-300 bg-base-200/40 p-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Queries driving this page</h3>
        {row.queries.length === 0 ? (
          <p className="mt-2 text-sm text-base-content/60">
            {row.coverage.includes("gsc")
              ? "Search Console has no query rows for this page in the fetched set."
              : "Search Console data is not available for this page."}
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {row.queries.map((query) => (
              <li key={query.query} className="flex justify-between gap-3">
                <span className="truncate">{query.query}</span>
                <span className="shrink-0 tabular-nums text-base-content/60">
                  {formatCount(query.clicks)} clicks ·{" "}
                  {formatPosition(query.position)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold">Tracked keywords ranking here</h3>
        {row.keywordCount == null ? (
          <p className="mt-2 text-sm text-base-content/60">
            Rank tracking is not configured for this project.
          </p>
        ) : row.trackedKeywords.length === 0 ? (
          <p className="mt-2 text-sm text-base-content/60">
            No tracked keywords currently rank on this URL.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {row.trackedKeywords.map((keyword) => (
              <li
                key={`${keyword.keyword}:${keyword.device}`}
                className="flex justify-between gap-3"
              >
                <span className="truncate">
                  {keyword.keyword}{" "}
                  <span className="text-base-content/50">{keyword.device}</span>
                </span>
                <span className="shrink-0 tabular-nums text-base-content/60">
                  #{formatPosition(keyword.position)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
