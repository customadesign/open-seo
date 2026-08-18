import { createColumnHelper } from "@tanstack/react-table";
import {
  AppDataTable,
  useAppTable,
} from "@/client/components/table/AppDataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import type { BacklinksNewLostData } from "./backlinksPageTypes";
import { BacklinksNewLostChart } from "./BacklinksPageCharts";
import { EmptyTableState } from "./BacklinksPageEmptyTableState";
import { formatCompactDate, formatNumber } from "./backlinksPageUtils";

const columnHelper = createColumnHelper<BacklinksNewLostData["rows"][number]>();

const columns = [
  columnHelper.accessor("date", {
    id: "date",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Date"
        helpText="Period end date."
      />
    ),
    cell: ({ getValue }) => formatCompactDate(getValue()),
  }),
  columnHelper.accessor("newBacklinks", {
    header: ({ column }) => (
      <SortableHeader column={column} label="New backlinks" helpText="" />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("lostBacklinks", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Lost backlinks" helpText="" />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("newReferringDomains", {
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="New referring domains"
        helpText=""
      />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("lostReferringDomains", {
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Lost referring domains"
        helpText=""
      />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
];

export function BacklinksNewLostPanel({
  data,
  isLoading,
  errorMessage,
  groupRange,
  onGroupRangeChange,
}: {
  data: BacklinksNewLostData | undefined;
  isLoading: boolean;
  errorMessage: string | null;
  groupRange: "day" | "week";
  onGroupRangeChange: (value: "day" | "week") => void;
}) {
  const table = useAppTable({
    data: data?.rows ?? [],
    columns,
  });

  if (errorMessage) {
    return (
      <div className="alert alert-error">
        <span>{errorMessage}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="New and lost interval"
        className="tabs tabs-border tabs-xs w-fit"
      >
        <button
          type="button"
          role="tab"
          aria-selected={groupRange === "week"}
          className={`tab ${groupRange === "week" ? "tab-active" : ""}`}
          onClick={() => onGroupRangeChange("week")}
        >
          Weekly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={groupRange === "day"}
          className={`tab ${groupRange === "day" ? "tab-active" : ""}`}
          onClick={() => onGroupRangeChange("day")}
        >
          Daily
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-base-content/60">
          Loading new and lost series...
        </p>
      ) : null}
      {!isLoading && data ? (
        <>
          <BacklinksNewLostChart data={data.rows} />
          {data.rows.length === 0 ? (
            <EmptyTableState label="No new or lost data for this range." />
          ) : (
            <AppDataTable table={table} />
          )}
        </>
      ) : null}
    </div>
  );
}
