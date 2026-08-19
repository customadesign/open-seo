import { z } from "zod";

// OpenRouter (with usage accounting on) reports the real USD cost of each
// response under providerMetadata.openrouter.usage.cost.
const openRouterUsageSchema = z.object({
  openrouter: z.object({ usage: z.object({ cost: z.number() }) }),
});

export function openRouterCostUsd(providerMetadata: unknown): number {
  const parsed = openRouterUsageSchema.safeParse(providerMetadata);
  return parsed.success ? parsed.data.openrouter.usage.cost : 0;
}
