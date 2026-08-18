import { useMemo, useState } from "react";
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
  runBacklinksBulkAnalysis,
} from "@/serverFunctions/backlinks";
import { MAX_BACKLINKS_BULK_TARGETS } from "@/shared/backlinks";
import type { BacklinksBulkData } from "./backlinksPageTypes";
import { formatNumber } from "./backlinksPageUtils";

const columnHelper = createColumnHelper<BacklinksBulkData["rows"][number]>();

const columns = [
  columnHelper.accessor("displayTarget", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Target" helpText="" />
    ),
    cell: ({ row, getValue }) => (
      <span>
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

function parseTargets(raw: string) {
  return [
    ...new Set(
      raw
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_BACKLINKS_BULK_TARGETS);
}

export function BacklinksBulkPanel({
  projectId,
  initialTargets = "",
}: {
  projectId: string;
  initialTargets?: string;
}) {
  const [rawTargets, setRawTargets] = useState(initialTargets);
  const targets = useMemo(() => parseTargets(rawTargets), [rawTargets]);
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
      estimateBacklinksBulkAnalysis({ data: { projectId, targets } }),
    onSuccess: (value) => {
      setEstimate(value);
      setResult(null);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not estimate cost")),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      runBacklinksBulkAnalysis({
        data: {
          projectId,
          targets,
          maxCostCredits: estimate!.costCredits,
        },
      }),
    onSuccess: setResult,
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not run analysis")),
  });

  return (
    <div className="space-y-4">
      <label className="form-control">
        <span className="label-text text-sm">
          Domains or URLs (one per line, up to {MAX_BACKLINKS_BULK_TARGETS})
        </span>
        <textarea
          className="textarea textarea-bordered min-h-32 font-mono text-sm"
          value={rawTargets}
          onChange={(event) => {
            setRawTargets(event.target.value);
            setEstimate(null);
            setResult(null);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={targets.length === 0 || estimateMutation.isPending}
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
        <span className="text-sm text-base-content/60">
          {targets.length} target{targets.length === 1 ? "" : "s"}
        </span>
      </div>
      {estimate ? (
        <p className="text-sm">
          Estimated {estimate.costCredits} credits ($
          {estimate.costUsd.toFixed(4)}) for {estimate.calls} provider calls.
          Cached repeats do not re-bill.
        </p>
      ) : null}
      {result ? (
        <div className="space-y-2">
          {result.fromCache ? (
            <p className="text-xs text-base-content/55">
              Showing cached snapshot. Re-sorting stays on this result.
            </p>
          ) : null}
          <AppDataTable table={table} />
        </div>
      ) : null}
    </div>
  );
}
