import { createColumnHelper } from "@tanstack/react-table";
import {
  AppDataTable,
  useAppTable,
} from "@/client/components/table/AppDataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import type { BacklinksOverviewData } from "./backlinksPageTypes";
import { BacklinksAuthorityChart } from "./BacklinksPageCharts";
import { EmptyTableState } from "./BacklinksPageEmptyTableState";
import { formatCompactDate, formatNumber } from "./backlinksPageUtils";

const columnHelper =
  createColumnHelper<BacklinksOverviewData["trends"][number]>();

const columns = [
  columnHelper.accessor("date", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Date" helpText="" />
    ),
    cell: ({ getValue }) => formatCompactDate(getValue()),
  }),
  columnHelper.accessor("rank", {
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Authority score"
        helpText="DataForSEO rank on a 0-100 scale."
      />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("backlinks", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Backlinks" helpText="" />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("referringDomains", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Referring domains" helpText="" />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
];

export function BacklinksAuthorityPanel({
  data,
}: {
  data: BacklinksOverviewData | undefined;
}) {
  const rows = data?.trends ?? [];
  const table = useAppTable({ data: rows, columns });

  if (!data || data.scope !== "domain") {
    return (
      <div className="alert alert-info">
        <span>
          Authority score trend is available for domain lookups only. Enter a
          bare domain to see the last 12 months.
        </span>
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyTableState label="No historical authority scores yet." />;
  }

  return (
    <div className="space-y-4">
      <BacklinksAuthorityChart data={rows} />
      <AppDataTable table={table} />
    </div>
  );
}
