import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  opportunityNextAction,
  opportunityScoreReasons,
  type SearchOpportunityRow,
} from "@/client/features/search-performance/searchOpportunityUi";

const helper = createColumnHelper<SearchOpportunityRow>();

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums align-top",
} as const;

// Unscored rows (no GA4 match) and missing GA4 metrics sort below every real
// value instead of landing in the middle of the queue.
const UNRANKED = -1;

function formatRate(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(0)}%`;
}

export function OpportunityPageCell({
  row,
  businessValueMetric,
}: {
  row: SearchOpportunityRow;
  businessValueMetric: string;
}) {
  const queries = row.topQueries.map((entry) => entry.query).join(", ");
  return (
    <div className="max-w-md space-y-1">
      {/^https?:\/\//.test(row.page) ? (
        <a
          href={row.page}
          target="_blank"
          rel="noreferrer"
          className="link link-hover block truncate font-medium"
          title={row.page}
        >
          {row.page}
        </a>
      ) : (
        <span className="block truncate font-medium" title={row.page}>
          {row.page}
        </span>
      )}
      <p className="truncate text-xs text-base-content/60" title={queries}>
        {queries ? `Ranks for: ${queries}` : "No ranking queries returned"}
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-base-content/60">
          Why this score
        </summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-base-content/70">
          {opportunityScoreReasons(row, businessValueMetric).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function OpportunityActionCell({ row }: { row: SearchOpportunityRow }) {
  const action = opportunityNextAction(row);
  return (
    <div className="max-w-xs space-y-0.5">
      <p className="font-medium">{action.label}</p>
      <p className="text-xs text-base-content/60">{action.detail}</p>
    </div>
  );
}

export function buildOpportunityColumns(
  businessValueMetric: string,
): ColumnDef<SearchOpportunityRow>[] {
  return [
    helper.display({
      id: "page",
      header: () => "Page and queries",
      cell: ({ row }) => (
        <OpportunityPageCell
          row={row.original}
          businessValueMetric={businessValueMetric}
        />
      ),
      meta: { cellClassName: "align-top" },
    }),
    helper.accessor((row) => row.score ?? UNRANKED, {
      id: "score",
      header: ({ column }) => (
        <SortableHeader column={column} label="Score" align="right" />
      ),
      cell: ({ row }) =>
        row.original.score == null ? (
          <span title="Not scored: no GA4 organic landing page matched">—</span>
        ) : (
          <span className="badge badge-sm badge-neutral">
            {row.original.score}
          </span>
        ),
      meta: rightAligned,
    }),
    helper.accessor("impressions", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("clicks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("ctr", {
      header: ({ column }) => (
        <SortableHeader column={column} label="CTR" align="right" />
      ),
      cell: ({ getValue }) => formatCtr(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("position", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Position" align="right" />
      ),
      cell: ({ getValue }) => formatPosition(getValue()),
      meta: rightAligned,
    }),
    helper.accessor((row) => row.ga4?.sessions ?? UNRANKED, {
      id: "sessions",
      header: ({ column }) => (
        <SortableHeader column={column} label="Sessions" align="right" />
      ),
      cell: ({ row }) =>
        row.original.ga4 ? formatCount(row.original.ga4.sessions) : "—",
      meta: rightAligned,
    }),
    helper.accessor((row) => row.ga4?.engagementRate ?? UNRANKED, {
      id: "engagementRate",
      header: ({ column }) => (
        <SortableHeader column={column} label="Engaged" align="right" />
      ),
      cell: ({ row }) => formatRate(row.original.ga4?.engagementRate),
      meta: rightAligned,
    }),
    helper.accessor((row) => row.ga4?.keyEvents ?? UNRANKED, {
      id: "keyEvents",
      header: ({ column }) => (
        <SortableHeader column={column} label="Key events" align="right" />
      ),
      cell: ({ row }) =>
        row.original.ga4 ? formatCount(row.original.ga4.keyEvents) : "—",
      meta: rightAligned,
    }),
    helper.display({
      id: "action",
      header: () => "Next action",
      cell: ({ row }) => <OpportunityActionCell row={row.original} />,
      meta: { cellClassName: "align-top" },
    }),
  ];
}
