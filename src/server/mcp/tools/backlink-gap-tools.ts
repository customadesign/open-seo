import { z } from "zod";
import { BacklinkGapService } from "@/server/features/gap/services/BacklinkGapService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { MAX_BACKLINK_GAP_COMPETITORS } from "@/shared/gap";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";

const compareInputSchema = {
  projectId: projectIdSchema,
  baseDomain: z
    .string()
    .min(1)
    .describe(
      "Base domain to compare. Defaults to the project domain if omitted.",
    )
    .optional(),
  competitorDomains: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_BACKLINK_GAP_COMPETITORS)
    .describe("1-3 competitor domains."),
} as const;

type CompareArgs = z.infer<z.ZodObject<typeof compareInputSchema>>;

function resolveBaseDomain(
  args: CompareArgs,
  project: { domain?: string | null },
) {
  const baseDomain = args.baseDomain ?? project.domain;
  if (!baseDomain) {
    throw new Error("baseDomain is required when the project has no domain.");
  }
  return baseDomain;
}

export const estimateBacklinkGapTool = {
  name: "estimate_backlink_gap",
  config: {
    title: "Estimate backlink gap cost",
    description:
      "Estimate the credit cost of a backlink-gap comparison without calling DataForSEO. Cached referring-domain snapshots and a fresh comparison are free. Ask the user to approve the returned costCredits before calling get_backlink_gap.",
    inputSchema: compareInputSchema,
    outputSchema: z
      .object({
        domainCount: z.number(),
        cachedDomainCount: z.number(),
        billedDomainCount: z.number(),
        costUsd: z.number(),
        costCredits: z.number(),
        fromCache: z.boolean(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: CompareArgs, context) => {
    const baseDomain = resolveBaseDomain(args, context.project);
    const estimate = await BacklinkGapService.estimate(
      {
        projectId: args.projectId,
        baseDomain,
        competitorDomains: args.competitorDomains,
      },
      context.billing,
    );
    return mcpResponse({
      text: `Backlink gap for ${baseDomain} vs ${args.competitorDomains.join(", ")}: ${estimate.billedDomainCount} of ${estimate.domainCount} domains would be billed at $${estimate.costUsd.toFixed(4)} (${estimate.costCredits} credits). Cached domains: ${estimate.cachedDomainCount}.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/backlink-gap`,
      ),
      structuredContent: estimate,
    });
  }),
};

const resultColumns: McpTableColumn<{
  referringDomain: string;
  rank: number | null;
  competitorCount: number;
}>[] = [
  { header: "referring domain", value: (row) => row.referringDomain },
  { header: "rank", value: (row) => row.rank },
  { header: "competitors", value: (row) => row.competitorCount },
];

export const getBacklinkGapTool = {
  name: "get_backlink_gap",
  config: {
    title: "Get backlink gap",
    description:
      "Find referring domains that link to 1-3 competitors but not to the base domain. Reuses cached snapshots when available. If the comparison will spend credits, pass the approved maxCostCredits from estimate_backlink_gap.",
    inputSchema: {
      ...compareInputSchema,
      maxCostCredits: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Approved credit ceiling from estimate_backlink_gap. Required when billedDomainCount > 0.",
        ),
    },
    outputSchema: z
      .object({
        runId: z.string(),
        totalCount: z.number(),
        rows: z.array(looseObjectOutputSchema),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: CompareArgs & { maxCostCredits?: number }, context) => {
      const baseDomain = resolveBaseDomain(args, context.project);
      const result = await BacklinkGapService.run(
        {
          projectId: args.projectId,
          baseDomain,
          competitorDomains: args.competitorDomains,
          maxCostCredits: args.maxCostCredits,
        },
        context.billing,
      );
      const preview = result.rows.slice(0, 25);
      return mcpResponse({
        text: [
          `Backlink gap for ${result.baseDomain} vs ${(result.competitorDomains ?? []).join(", ")}: ${result.totalCount} referring domains.`,
          preview.length === 0
            ? "No competitor-only referring domains found."
            : formatMcpTable(preview, resultColumns),
        ].join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/backlink-gap`,
        ),
        structuredContent: result,
      });
    },
  ),
};
