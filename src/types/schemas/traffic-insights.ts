import { z } from "zod";
import { SEARCH_PERFORMANCE_RANGES } from "@/types/schemas/search-performance";

export const trafficInsightsInputSchema = z.object({
  projectId: z.string().min(1),
  dateRange: z.enum(SEARCH_PERFORMANCE_RANGES).default("last_28_days"),
});
