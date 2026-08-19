import { useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import type { SortingState } from "@tanstack/react-table";
import {
  AppDataTable,
  useAppTable,
} from "@/client/components/table/AppDataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { HeaderHelpLabel } from "@/client/features/keywords/components";
import { COMMERCIAL_ANCHOR_SHARE_THRESHOLD } from "@/shared/backlinks";
import type { BacklinksAnchorsData } from "./backlinksPageTypes";
import { EmptyTableState } from "./BacklinksPageEmptyTableState";
import { formatNumber } from "./backlinksPageUtils";

const columnHelper = createColumnHelper<BacklinksAnchorsData["rows"][number]>();

const columns = [
  columnHelper.accessor("anchor", {
    id: "anchor",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Anchor"
        helpText="Visible anchor text used by referring links."
      />
    ),
    cell: ({ getValue }) => getValue() || "(empty)",
  }),
  columnHelper.accessor("referringDomains", {
    id: "referringDomains",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Referring Domains"
        helpText="Unique domains using this anchor."
      />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("backlinks", {
    id: "backlinks",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Backlinks"
        helpText="Total backlinks using this anchor."
      />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("share", {
    id: "share",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Share"
        helpText="Share of fetched backlinks that use this anchor."
      />
    ),
    cell: ({ getValue }) => `${(getValue() * 100).toFixed(1)}%`,
    sortDescFirst: true,
  }),
  columnHelper.accessor("kind", {
    id: "kind",
    header: () => (
      <HeaderHelpLabel
        label="Kind"
        helpText="Brand, URL, generic, empty, or commercial/keyword."
      />
    ),
  }),
];

export function BacklinksAnchorsPanel({
  data,
  isLoading,
  errorMessage,
}: {
  data: BacklinksAnchorsData | undefined;
  isLoading: boolean;
  errorMessage: string | null;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "backlinks", desc: true },
  ]);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) =>
      (row.anchor ?? "").toLowerCase().includes(needle),
    );
  }, [data?.rows, query]);
  const table = useAppTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (errorMessage) {
    return (
      <div className="alert alert-error">
        <span>{errorMessage}</span>
      </div>
    );
  }
  if (isLoading) {
    return <p className="text-sm text-base-content/60">Loading anchors...</p>;
  }
  if (!data || data.rows.length === 0) {
    return <EmptyTableState label="No anchors found for this target." />;
  }

  return (
    <div className="space-y-3">
      {data.concentratedAnchors.length > 0 ? (
        <div className="alert alert-warning">
          <span>
            Commercial/keyword anchors at or above{" "}
            {(COMMERCIAL_ANCHOR_SHARE_THRESHOLD * 100).toFixed(0)}% of fetched
            backlinks: {data.concentratedAnchors.join(", ")}
          </span>
        </div>
      ) : null}
      <input
        type="search"
        className="input input-bordered input-sm w-full max-w-sm"
        placeholder="Filter anchors"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <AppDataTable
        table={table}
        getRowClassName={(row) =>
          row.original.concentrated ? "bg-warning/10" : undefined
        }
        getCellClassName={(_, columnId) =>
          columnId === "anchor" ? "min-w-64" : undefined
        }
      />
    </div>
  );
}
