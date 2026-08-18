import { createServerFn } from "@tanstack/react-start";
import { OrganicTrafficInsightsService } from "@/server/features/traffic-insights/services/OrganicTrafficInsightsService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { trafficInsightsInputSchema } from "@/types/schemas/traffic-insights";

export const getOrganicTrafficInsights = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(trafficInsightsInputSchema)
  .handler(async ({ data, context }) => {
    return OrganicTrafficInsightsService.getInsights({
      projectId: context.projectId,
      dateRange: data.dateRange,
    });
  });
