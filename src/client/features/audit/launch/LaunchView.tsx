import { useCustomer } from "autumn-js/react";
import { useQuery } from "@tanstack/react-query";
import { AuditHistorySection } from "@/client/features/audit/launch/AuditHistorySection";
import { AuditScheduleCard } from "@/client/features/audit/launch/AuditScheduleCard";
import { LaunchFormCard } from "@/client/features/audit/launch/LaunchFormCard";
import { useLaunchController } from "@/client/features/audit/launch/useLaunchController";
import { getCustomerPlanStatus } from "@/client/features/billing/plan-detection";
import { useSession } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { getAuditHistory } from "@/serverFunctions/audit";

type LaunchViewProps = {
  projectId: string;
  onAuditStarted: (auditId: string) => void;
};

export function LaunchView(props: LaunchViewProps) {
  const accessQuery = useWorkspaceAccess();
  if (accessQuery.data?.role === "client") {
    return <ClientAuditHistory {...props} />;
  }
  // Self-hosted has no Autumn customer and resolves to the paid tier on the
  // server, so only hosted mode needs to look up the plan.
  if (!isHostedClientAuthMode()) {
    return <LaunchContent {...props} isFreePlan={false} />;
  }

  return <HostedLaunchView {...props} />;
}

function ClientAuditHistory({ projectId }: LaunchViewProps) {
  const historyQuery = useQuery({
    queryKey: ["audit-history", projectId],
    queryFn: () => getAuditHistory({ data: { projectId } }),
  });
  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Site Audit</h1>
          <p className="mt-1 text-sm text-base-content/60">
            View completed and historical audit reports.
          </p>
        </div>
        <AuditHistorySection
          projectId={projectId}
          history={(historyQuery.data ?? []).filter(
            (audit) => audit.status === "completed",
          )}
          isLoading={historyQuery.isLoading}
          onDelete={() => undefined}
          readOnly
        />
      </div>
    </div>
  );
}

function HostedLaunchView(props: LaunchViewProps) {
  const { data: session } = useSession();
  const customerQuery = useCustomer({
    queryOptions: {
      enabled: Boolean(session?.user?.id),
    },
  });

  // Until the customer loads, leave the form unrestricted rather than flash
  // free-plan copy at paid users; the server enforces the limit regardless.
  const isFreePlan =
    customerQuery.data != null &&
    getCustomerPlanStatus(customerQuery.data) === "free";

  return <LaunchContent {...props} isFreePlan={isFreePlan} />;
}

function LaunchContent({
  projectId,
  isFreePlan,
  onAuditStarted,
}: LaunchViewProps & { isFreePlan: boolean }) {
  const controller = useLaunchController({
    projectId,
    isFreePlan,
    onAuditStarted,
  });

  return (
    <div className="px-4 py-4 md:px-6 md:py-6 pb-24 md:pb-8 overflow-auto">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Site Audit</h1>

        <LaunchFormCard
          launchForm={controller.launchForm}
          commitMaxPagesInput={controller.commitMaxPagesInput}
          maxPagesLimit={controller.maxPagesLimit}
        />

        <AuditScheduleCard projectId={projectId} />

        <AuditHistorySection
          projectId={projectId}
          history={controller.historyQuery.data ?? []}
          isLoading={controller.historyQuery.isLoading}
          onDelete={controller.deleteAudit}
        />
      </div>
    </div>
  );
}
