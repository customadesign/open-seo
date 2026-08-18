import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ga4ConnectCard } from "@/client/features/dashboard/Ga4ConnectCard";
import { Ga4DashboardCards } from "@/client/features/dashboard/Ga4DashboardCards";
import {
  ga4DashboardHasDataForSort,
  shouldShowDashboardGa4,
} from "@/client/features/dashboard/ga4Dashboard";
import {
  AuditHealthCard,
  BacklinkPulseCard,
  GscCard,
} from "@/client/features/dashboard/DashboardCards";
import { MetricSummaryCards } from "@/client/features/dashboard/MetricSummaryCards";
import { McpConnectCard } from "@/client/features/dashboard/McpConnectCard";
import { OnboardingChecklist } from "@/client/features/dashboard/OnboardingChecklist";
import { WorkspaceMergeBanner } from "@/client/features/dashboard/WorkspaceMergeBanner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getDashboardActivation,
  getDashboardOverview,
  refreshDashboardBacklinkSnapshot,
} from "@/serverFunctions/dashboard";
import { GA4_OAUTH_APP_PENDING } from "@/shared/ga4";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { isHostedClientAuthMode } from "@/lib/auth-mode";

export function DashboardPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const accessQuery = useWorkspaceAccess();
  const canUseProjectTools = accessQuery.data?.canUseProjectTools === true;
  const canManageWorkspace = accessQuery.data?.canManageWorkspace === true;

  const activationQuery = useQuery({
    queryKey: ["dashboardActivation", projectId],
    queryFn: () => getDashboardActivation({ data: { projectId } }),
  });
  const overviewQuery = useQuery({
    queryKey: ["dashboardOverview", projectId],
    queryFn: () => getDashboardOverview({ data: { projectId } }),
  });

  const activation = activationQuery.data;
  const overview = overviewQuery.data;

  // Visit-triggered backlink snapshot: fire once per page view when the
  // overview reports a missing or stale snapshot for a project with a domain.
  // The server re-checks freshness, so a stray double-fire costs nothing.
  const refreshMutation = useMutation({
    mutationFn: () => refreshDashboardBacklinkSnapshot({ data: { projectId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["dashboardOverview", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboardMetrics", projectId],
      });
    },
  });
  const refreshFiredRef = useRef(false);
  const needsSnapshot =
    canUseProjectTools &&
    activation?.domain != null &&
    overview !== undefined &&
    (overview.backlinks === null || overview.backlinks.stale);
  useEffect(() => {
    if (!needsSnapshot || refreshFiredRef.current) return;
    refreshFiredRef.current = true;
    refreshMutation.mutate();
  }, [needsSnapshot, refreshMutation]);

  if (activationQuery.isError) {
    return (
      <div className="px-4 py-4 md:px-6 md:py-6">
        <div className="alert alert-error">
          {getStandardErrorMessage(activationQuery.error)}
        </div>
      </div>
    );
  }

  // Wait for the overview too: rendering cards from `overview === undefined`
  // flashes their empty states (and reshuffles the data-first sort) once the
  // real data lands. An overview error falls through so the page still loads.
  if (!activation || overviewQuery.isPending) {
    return (
      <div
        className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-4 md:px-6 md:py-6"
        aria-busy
      >
        <div className="skeleton h-8 w-52" />
        <div className="skeleton h-36" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="skeleton h-44" />
          <div className="skeleton h-44" />
        </div>
      </div>
    );
  }

  const showBacklinks = activation.domain !== null;
  const gscConnected = activation.gsc.connected;
  const ga4Connected = activation.ga4.connected;
  const showGa4 =
    canUseProjectTools &&
    shouldShowDashboardGa4({
      hosted: isHostedClientAuthMode(),
      oauthAppPending: GA4_OAUTH_APP_PENDING,
      connected: ga4Connected,
      dismissedAt: activation.ga4.cardDismissedAt,
    });

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        {canManageWorkspace ? <WorkspaceMergeBanner /> : null}

        {canManageWorkspace ? (
          <OnboardingChecklist projectId={projectId} activation={activation} />
        ) : null}

        {/* Fixed-order scoreboard: the seven headline metrics stay put so the
          page reads the same on every visit, above the detail cards below. */}
        <MetricSummaryCards
          projectId={projectId}
          canUseProjectTools={canUseProjectTools}
        />

        {/* Every card is half width on large screens (only the checklist spans).
          Cards with data render before setup pitches and empty states. */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {[
            // Array order is the within-bucket order after the data-first sort:
            // the MCP pitch leads the setup cards.
            ...(!canUseProjectTools ||
            activation.mcp.firstToolCallAt ||
            activation.mcp.cardDismissedAt
              ? []
              : [
                  {
                    key: "mcp",
                    hasData: false,
                    node: (
                      <McpConnectCard
                        projectId={projectId}
                        activation={activation}
                      />
                    ),
                  },
                ]),
            {
              key: "gsc",
              hasData: gscConnected,
              node: (
                <GscCard
                  projectId={projectId}
                  connected={gscConnected}
                  canManageConnection={canManageWorkspace}
                />
              ),
            },
            ...(showGa4 && (ga4Connected || canManageWorkspace)
              ? [
                  {
                    key: "ga4",
                    hasData: ga4DashboardHasDataForSort({
                      gscConnected,
                      ga4Connected,
                    }),
                    node: ga4Connected ? (
                      <Ga4DashboardCards
                        projectId={projectId}
                        connected={ga4Connected}
                      />
                    ) : (
                      <Ga4ConnectCard
                        projectId={projectId}
                        connected={ga4Connected}
                      />
                    ),
                  },
                ]
              : []),
            {
              key: "audit",
              hasData: overview?.audit != null,
              node: (
                <AuditHealthCard
                  projectId={projectId}
                  audit={overview?.audit ?? null}
                />
              ),
            },
            ...(showBacklinks
              ? [
                  {
                    key: "backlinks",
                    hasData:
                      overview?.backlinks != null || refreshMutation.isPending,
                    node: (
                      <BacklinkPulseCard
                        projectId={projectId}
                        backlinks={overview?.backlinks ?? null}
                        refreshing={refreshMutation.isPending}
                      />
                    ),
                  },
                ]
              : []),
          ]
            .toSorted((a, b) => Number(b.hasData) - Number(a.hasData))
            .map((card) => (
              <div
                key={card.key}
                className={card.key === "ga4" ? "contents" : undefined}
              >
                {card.node}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
