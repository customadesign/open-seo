import { waitUntil } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { ActivationRepository } from "@/server/features/activation/repositories/ActivationRepository";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import { dashboardProjectInputSchema } from "@/types/schemas/dashboard";

export const getDashboardActivation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardService.getActivation({
      projectId: context.projectId,
      organizationId: context.organizationId,
      domain: context.project.domain,
    }),
  );

export const getDashboardOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    const overview = await DashboardService.getOverview({
      projectId: context.projectId,
      domain: context.project.domain,
    });
    if (
      context.access.role === "client" &&
      overview.audit?.status !== "completed"
    ) {
      return { ...overview, audit: null };
    }
    return overview;
  });

// Read-only: the seven summary cards render from persisted snapshots, so this
// is safe for every role and never spends credits.
export const getDashboardMetrics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardService.getMetrics({
      projectId: context.projectId,
      domain: context.project.domain,
    }),
  );

// Visit-triggered snapshot top-up for the summary cards. `requireProjectUse`
// keeps client-role accounts read-only: they see whatever data exists but never
// trigger metered provider calls. The service re-checks freshness server-side,
// so a stray double-fire costs nothing.
export const refreshDashboardMetrics = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    const { aiRunPlan } = await DashboardService.refreshMetricSnapshots({
      projectId: context.projectId,
      projectName: context.project.name,
      domain: context.project.domain,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
      billingCustomer: context,
    });

    if (aiRunPlan) {
      // waitUntil, not void: workerd cancels unregistered pending I/O once the
      // response is sent, so the baseline run would never finish. The dashboard
      // shows "collecting" until the run lands.
      waitUntil(
        AiVisibilityService.executeRun(aiRunPlan, context).catch((error) => {
          console.error("dashboard: ai visibility baseline run failed", error);
        }),
      );
    }

    return { aiRunQueued: aiRunPlan !== null };
  });

// Visit-triggered: the client calls this when the overview reports a missing
// or stale backlink snapshot. Metered against org credits at most once per
// project per day (the service re-checks freshness server-side).
export const refreshDashboardBacklinkSnapshot = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardService.ensureBacklinkSnapshot({
      projectId: context.projectId,
      domain: context.project.domain,
      billingCustomer: context,
    }),
  );

export const markDashboardCompetitorClicked = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markCompetitorStepClicked(context.projectId);
    return { ok: true as const };
  });

// "I already connected" on the MCP card. Hides the card for this project;
// the org-level milestone stays untouched and self-corrects on the next
// real external tool call.
export const dismissDashboardMcpCard = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markMcpCardDismissed(context.projectId);
    return { ok: true as const };
  });

// Hides only the optional GA4 pitch on this project's dashboard. The
// integration remains available in Project Settings and a later connection
// makes the dashboard card visible again.
export const dismissDashboardGa4Card = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markGa4CardDismissed(context.projectId);
    return { ok: true as const };
  });
