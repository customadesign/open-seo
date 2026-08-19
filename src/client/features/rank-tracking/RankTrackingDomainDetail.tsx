import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCustomer } from "autumn-js/react";
import {
  getLatestRankResults,
  getRankPositionMatrix,
  estimateRankCheckCost,
} from "@/serverFunctions/rank-tracking";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { getCustomerPlanStatus } from "@/client/features/billing/plan-detection";
import { captureClientEvent } from "@/client/lib/posthog";
import { FreePlanAlert } from "./FreePlanAlert";
import { RankTrackingDetailHeader } from "./RankTrackingDetailHeader";
import { RankTrackingOverview } from "./RankTrackingOverview";
import { countMatrixRuns } from "./RankTrackingHistoryMatrix";
import { RankTrackingTableToolbar } from "./RankTrackingTableToolbar";
import {
  RankTrackingReportTabs,
  type RankReportTab,
} from "./RankTrackingReportTabs";
import { RankTrackingReportBody } from "./RankTrackingReportBody";
import {
  exportRankTrackingCsv,
  exportRankTrackingToSheets,
} from "./RankTrackingTableParts";
import type {
  RankTrackingConfig,
  ComparePeriod,
} from "@/types/schemas/rank-tracking";
import { AddKeywordsPanel } from "./AddKeywordsPanel";
import { rankTrackingSkipReasonLabel } from "./rankTrackingUi";
import {
  FilterPanel,
  applyFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  type Filters,
} from "./RankTrackingFilters";
import { CheckConfirmModal } from "./CheckConfirmModal";
import { useMetricsRefresh } from "./useMetricsRefresh";
import { useRankCheckTrigger } from "./useRankCheckTrigger";
import { useRankRunPolling } from "./useRankRunPolling";
import { ImportedRankHistory } from "./ImportedRankHistory";

function deviceVisibility(
  devices: RankTrackingConfig["devices"],
  activeDevice: "desktop" | "mobile",
): { showDesktop: boolean; showMobile: boolean } {
  if (devices === "both") {
    return {
      showDesktop: activeDevice === "desktop",
      showMobile: activeDevice === "mobile",
    };
  }
  return {
    showDesktop: devices !== "mobile",
    showMobile: devices !== "desktop",
  };
}

export function RankTrackingDomainDetail({
  config,
  projectId,
  onBack,
  onEdit,
  readOnly = false,
}: {
  config: RankTrackingConfig;
  projectId: string;
  onBack: () => void;
  onEdit: () => void;
  readOnly?: boolean;
}) {
  const { data: session } = useSession();
  const customerQuery = useCustomer({
    queryOptions: { enabled: Boolean(session?.user?.id) && !readOnly },
  });
  const isFreePlan =
    !!customerQuery.data &&
    getCustomerPlanStatus(customerQuery.data) === "free";

  const queryClient = useQueryClient();
  const [showAddKeywords, setShowAddKeywords] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>(
    config.scheduleInterval === "daily"
      ? "1d"
      : config.scheduleInterval === "monthly"
        ? "30d"
        : "7d",
  );
  const [activeDevice, setActiveDevice] = useState<"desktop" | "mobile">(
    config.devices === "mobile" ? "mobile" : "desktop",
  );
  const [viewMode, setViewMode] = useState<RankReportTab>("keywords");

  const { data: resultsData, isLoading: resultsLoading } = useQuery({
    queryKey: ["rankTrackingResults", projectId, config.id, comparePeriod],
    queryFn: () =>
      getLatestRankResults({
        data: { projectId, configId: config.id, comparePeriod },
      }),
  });

  const latestRun = useRankRunPolling(projectId, config.id);

  // Also feeds the History toggle: the matrix view only earns its tab once
  // there are two checks to compare.
  const { data: matrixCells, isLoading: matrixLoading } = useQuery({
    queryKey: ["rankPositionMatrix", projectId, config.id, activeDevice],
    queryFn: () =>
      getRankPositionMatrix({
        data: { projectId, configId: config.id, device: activeDevice },
      }),
  });
  const historyAvailable = countMatrixRuns(matrixCells ?? []) >= 2;

  const { data: costEstimate } = useQuery({
    queryKey: ["rankTrackingCostEstimate", projectId, config.id],
    queryFn: () =>
      estimateRankCheckCost({ data: { projectId, configId: config.id } }),
    enabled: !readOnly,
  });

  const [pendingCheck, setPendingCheck] = useState<{
    count: number;
    keywordIds?: string[];
  } | null>(null);

  const handleKeywordsAdded = (result: {
    added: number;
    checkTriggered: boolean;
  }) => {
    void queryClient.invalidateQueries({
      queryKey: ["rankTrackingCostEstimate", projectId, config.id],
    });
    void queryClient.invalidateQueries({
      queryKey: ["rankTrackingResults", projectId, config.id],
    });
    void queryClient.invalidateQueries({
      queryKey: ["rankTrackingLatestRun", projectId, config.id],
    });
    setShowAddKeywords(false);
    captureClientEvent("rank_tracking:keywords_add");
    toast.success(
      `${result.added} keyword${result.added !== 1 ? "s" : ""} added`,
    );
    if (!result.checkTriggered && result.added > 0) {
      toast.info("Use 'Check Now' to check these keywords");
    }
  };

  const isRunning =
    (latestRun?.status === "pending" || latestRun?.status === "running") &&
    !latestRun?.maybeStale;
  const { startCheck, isBusy, isPending } = useRankCheckTrigger({
    configId: config.id,
    isRunning,
    projectId,
    onSuccess: () => setPendingCheck(null),
  });

  const { refresh: refreshMetrics, isRefreshing: metricsRefreshing } =
    useMetricsRefresh(projectId, config.id);

  const requestCheck = (count: number, keywordIds?: string[]) => {
    if (count < 50) {
      startCheck({ keywordIds });
      return;
    }

    if (isBusy) return;
    setPendingCheck({ count, keywordIds });
  };

  const rows = resultsData?.rows;
  const run = resultsData?.run;
  const hasBothDevices = config.devices === "both";
  const { showDesktop, showMobile } = deviceVisibility(
    config.devices,
    activeDevice,
  );
  const filtered = useMemo(
    () => applyFilters(rows ?? [], filters),
    [rows, filters],
  );
  const activeFilterCount = countActiveFilters(filters);
  const defaultSortId = showDesktop ? "desktopPosition" : "mobilePosition";
  // Fall back to keywords if history disappears (e.g. device switch).
  const effectiveViewMode =
    viewMode === "history" && !historyAvailable ? "keywords" : viewMode;
  const showKeywordTable =
    effectiveViewMode === "keywords" || effectiveViewMode === "history";

  return (
    <div className="space-y-3">
      <button
        className="btn btn-ghost btn-xs gap-1 -ml-2 text-base-content/60"
        onClick={onBack}
      >
        <ArrowLeft className="size-3" />
        Back to domains
      </button>

      {rankTrackingSkipReasonLabel(config.lastSkipReason) && (
        <div className="alert alert-warning text-sm py-2">
          <AlertTriangle className="size-4" />
          <span>
            The last scheduled check was skipped —{" "}
            {rankTrackingSkipReasonLabel(config.lastSkipReason)}. The schedule
            still advances; fix the cause to resume automatic tracking.
          </span>
        </div>
      )}

      {latestRun?.maybeStale && (
        <div className="alert alert-warning text-sm py-2">
          <AlertTriangle className="size-4" />
          <span>
            This run may be unresponsive and will be cleaned up automatically.
          </span>
        </div>
      )}

      <FreePlanAlert visible={!readOnly && isFreePlan} />

      {/* Results card */}
      <div className="flex-1 flex flex-col min-w-0 border border-base-300 rounded-xl bg-base-100 overflow-hidden">
        {/* Domain header */}
        <RankTrackingDetailHeader
          config={config}
          run={run}
          costEstimate={costEstimate}
          hasBothDevices={hasBothDevices}
          activeDevice={activeDevice}
          onActiveDeviceChange={setActiveDevice}
          comparePeriod={comparePeriod}
          onComparePeriodChange={setComparePeriod}
          onEdit={onEdit}
          onToggleAddKeywords={() => setShowAddKeywords((c) => !c)}
          readOnly={readOnly}
        />

        {showAddKeywords && !readOnly && (
          <div className="px-4 pb-3">
            <AddKeywordsPanel
              configId={config.id}
              projectId={projectId}
              onSuccess={handleKeywordsAdded}
              onCancel={() => setShowAddKeywords(false)}
            />
          </div>
        )}

        {(rows?.length ?? 0) > 0 && effectiveViewMode === "keywords" && (
          <RankTrackingOverview
            device={activeDevice}
            projectId={projectId}
            configId={config.id}
          />
        )}

        <RankTrackingReportTabs
          value={effectiveViewMode}
          onChange={setViewMode}
          historyAvailable={historyAvailable}
        />

        <ImportedRankHistory projectId={projectId} configId={config.id} />

        {/* Table toolbar */}
        <RankTrackingTableToolbar
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((c) => !c)}
          activeFilterCount={activeFilterCount}
          isRunning={isRunning}
          latestRun={latestRun}
          keywordCount={filtered.length}
          viewMode={effectiveViewMode === "history" ? "history" : "table"}
          onViewModeChange={(mode) =>
            setViewMode(mode === "history" ? "history" : "keywords")
          }
          historyAvailable={false}
          showFilterButton={showKeywordTable}
          onExport={() =>
            exportRankTrackingCsv(
              filtered,
              showDesktop,
              showMobile,
              config.domain,
              config.locationName,
            )
          }
          onExportToSheets={() =>
            exportRankTrackingToSheets(
              filtered,
              showDesktop,
              showMobile,
              config.locationName,
            )
          }
          onCopyKeywords={() => {
            void navigator.clipboard.writeText(
              filtered.map((r) => r.keyword).join("\n"),
            );
            toast.success("Keywords copied to clipboard");
          }}
          onCheckNow={() => {
            const count = costEstimate?.keywordCount ?? rows?.length ?? 0;
            if (count > 0) requestCheck(count);
          }}
          onRefreshMetrics={refreshMetrics}
          metricsRefreshing={metricsRefreshing}
          checkBusy={isBusy}
          checkDisabled={isFreePlan}
          hasData={filtered.length > 0}
          readOnly={readOnly}
        />

        {showKeywordTable && showFilters && (
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            activeFilterCount={activeFilterCount}
            onReset={() => setFilters(EMPTY_FILTERS)}
          />
        )}

        <div className="p-4">
          <RankTrackingReportBody
            tab={effectiveViewMode}
            projectId={projectId}
            config={config}
            device={activeDevice}
            readOnly={readOnly}
            rows={rows ?? []}
            filtered={filtered}
            resultsLoading={resultsLoading}
            showDesktop={showDesktop}
            showMobile={showMobile}
            defaultSortId={defaultSortId}
            matrixCells={matrixCells}
            matrixLoading={matrixLoading}
          />
        </div>
      </div>

      {pendingCheck && !readOnly && (
        <CheckConfirmModal
          keywordCount={pendingCheck.count}
          devices={config.devices}
          engine={config.engine}
          serpDepth={config.serpDepth}
          isPending={isPending}
          onRunNow={() =>
            startCheck({
              keywordIds: pendingCheck.keywordIds,
            })
          }
          onCancel={() => setPendingCheck(null)}
        />
      )}
    </div>
  );
}
