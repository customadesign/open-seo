import { z } from "zod";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { MAX_BACKLINKS_BULK_TARGETS } from "@/shared/backlinks";

const inputSchema = {
  projectId: projectIdSchema,
  targets: z
    .array(z.string().min(1).max(2048))
    .min(1)
    .max(MAX_BACKLINKS_BULK_TARGETS)
    .describe(
      "Domains or URLs to estimate. One to 200 values. Estimate does not spend credits.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const estimateBacklinksBulkAnalysisTool = {
  name: "estimate_backlinks_bulk_analysis",
  config: {
    title: "Estimate backlinks bulk analysis",
    description:
      "Estimate credits for analyzing up to 200 domains or URLs (authority score, referring domains, backlinks, organic traffic) without spending. One batch of four provider calls regardless of target count. Show the estimate, then call analyze_backlinks_bulk with maxCostCredits set to the approved amount.",
    inputSchema,
    outputSchema: z
      .object({
        costUsd: z.number(),
        costCredits: z.number(),
        targetCount: z.number(),
        billedTargetLimit: z.number(),
        calls: z.number(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const estimate = BacklinksService.estimateBulkAnalysis();
    return mcpResponse({
      text: `Bulk analysis of ${args.targets.length} target${args.targets.length === 1 ? "" : "s"} is estimated at $${estimate.costUsd.toFixed(4)} (${estimate.costCredits} credits) for ${estimate.calls} provider calls. Cached repeats do not re-bill. No analysis was started.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/backlinks`,
        { tab: "bulk" },
      ),
      structuredContent: {
        ...estimate,
        targetCount: args.targets.length,
      },
    });
  }),
};
