import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  AppDataTable,
  useAppTable,
} from "@/client/components/table/AppDataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  estimateBacklinksBulkAnalysis,
  runBacklinksCompetitorComparison,
} from "@/serverFunctions/backlinks";
import { MAX_BACKLINKS_COMPETITORS } from "@/shared/backlinks";
import type { BacklinksBulkData } from "./backlinksPageTypes";
import { formatNumber } from "./backlinksPageUtils";

const columnHelper = createColumnHelper<BacklinksBulkData["rows"][number]>();

const columns = [
  columnHelper.accessor("displayTarget", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Domain" helpText="" />
    ),
    cell: ({ row, getValue }) => (
      <span className={row.original.isPrimary ? "font-semibold" : undefined}>
        {getValue()}
        {row.original.isPrimary ? (
          <span className="badge badge-outline badge-xs ml-2">This site</span>
        ) : null}
      </span>
    ),
  }),
  columnHelper.accessor("authorityScore", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Authority" helpText="" />
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
  columnHelper.accessor("backlinks", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Backlinks" helpText="" />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
  columnHelper.accessor("organicTraffic", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Organic traffic" helpText="" />
    ),
    cell: ({ getValue }) => formatNumber(getValue()),
    sortDescFirst: true,
  }),
];

export function BacklinksComparePanel({
  projectId,
  target,
}: {
  projectId: string;
  target: string;
}) {
  const [competitors, setCompetitors] = useState(["", "", ""]);
  const filled = competitors.map((value) => value.trim()).filter(Boolean);
  const [estimate, setEstimate] = useState<Awaited<
    ReturnType<typeof estimateBacklinksBulkAnalysis>
  > | null>(null);
  const [result, setResult] = useState<BacklinksBulkData | null>(null);
  const table = useAppTable({
    data: result?.rows ?? [],
    columns,
  });

  const estimateMutation = useMutation({
    mutationFn: () =>
      estimateBacklinksBulkAnalysis({
        data: { projectId, targets: [target, ...filled] },
      }),
    onSuccess: (value) => {
      setEstimate(value);
      setResult(null);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not estimate cost")),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      runBacklinksCompetitorComparison({
        data: {
          projectId,
          target,
          competitors: filled,
          maxCostCredits: estimate!.costCredits,
        },
      }),
    onSuccess: setResult,
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not compare domains")),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-3">
        {competitors.map((value, index) => (
          <input
            key={index}
            className="input input-bordered input-sm"
            placeholder={`Competitor ${index + 1}`}
            value={value}
            onChange={(event) => {
              const next = [...competitors];
              next[index] = event.target.value;
              setCompetitors(next);
              setEstimate(null);
              setResult(null);
            }}
          />
        ))}
      </div>
      <p className="text-xs text-base-content/55">
        Up to {MAX_BACKLINKS_COMPETITORS} competitor domains, compared with{" "}
        {target}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={filled.length === 0 || estimateMutation.isPending}
          onClick={() => estimateMutation.mutate()}
        >
          Review estimate
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!estimate || runMutation.isPending}
          onClick={() => runMutation.mutate()}
        >
          Run approved estimate
        </button>
      </div>
      {estimate ? (
        <p className="text-sm">
          Estimated {estimate.costCredits} credits ($
          {estimate.costUsd.toFixed(4)}
          ). Cached repeats do not re-bill.
        </p>
      ) : null}
      {result ? <AppDataTable table={table} /> : null}
    </div>
  );
}
