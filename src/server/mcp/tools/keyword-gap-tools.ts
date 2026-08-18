import { z } from "zod";
import { KeywordGapService } from "@/server/features/gap/services/KeywordGapService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import {
  assertLabsLocationCode,
  assertLanguageForLocation,
} from "@/server/lib/market";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";
import {
  KEYWORD_GAP_CLASSIFICATIONS,
  MAX_KEYWORD_GAP_COMPETITORS,
} from "@/shared/gap";
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
    .max(MAX_KEYWORD_GAP_COMPETITORS)
    .describe("1-4 competitor domains."),
  includeSubdomains: z.boolean().optional().default(true),
  locationCode: locationCodeSchema.optional(),
  languageCode: languageCodeSchema.optional(),
} as const;

const estimateOutputSchema = z
  .object({
    domainCount: z.number(),
    cachedDomainCount: z.number(),
    billedDomainCount: z.number(),
    costUsd: z.number(),
    costCredits: z.number(),
    fromCache: z.boolean(),
    ...optionalMetaOutputSchema,
  })
  .passthrough();

type CompareArgs = z.infer<z.ZodObject<typeof compareInputSchema>>;

async function resolveCompareInput(
  args: CompareArgs,
  context: {
    project: {
      domain?: string | null;
      locationCode: number;
      languageCode: string;
    };
  },
) {
  const baseDomain = args.baseDomain ?? context.project.domain;
  if (!baseDomain) {
    throw new Error("baseDomain is required when the project has no domain.");
  }
  const market = resolveLabsMarket(args, context.project);
  assertLabsLocationCode(market.locationCode);
  assertLanguageForLocation(market.locationCode, market.languageCode);
  return {
    baseDomain,
    competitorDomains: args.competitorDomains,
    includeSubdomains: args.includeSubdomains,
    ...market,
  };
}

export const estimateKeywordGapTool = {
  name: "estimate_keyword_gap",
  config: {
    title: "Estimate keyword gap cost",
    description:
      "Estimate the credit cost of a keyword-gap comparison without calling DataForSEO. Cached domain snapshots and a fresh comparison are free. Ask the user to approve the returned costCredits before calling get_keyword_gap.",
    inputSchema: compareInputSchema,
    outputSchema: estimateOutputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: CompareArgs, context) => {
    const input = await resolveCompareInput(args, context);
    const estimate = await KeywordGapService.estimate(
      { ...input, projectId: args.projectId },
      context.billing,
    );
    return mcpResponse({
      text: `Keyword gap for ${input.baseDomain} vs ${input.competitorDomains.join(", ")}: ${estimate.billedDomainCount} of ${estimate.domainCount} domains would be billed at $${estimate.costUsd.toFixed(4)} (${estimate.costCredits} credits). Cached domains: ${estimate.cachedDomainCount}.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/keyword-gap`,
      ),
      structuredContent: estimate,
    });
  }),
};

const resultColumns: McpTableColumn<{
  keyword: string;
  classification: string;
  searchVolume: number | null;
}>[] = [
  { header: "keyword", value: (row) => row.keyword },
  { header: "class", value: (row) => row.classification },
  { header: "volume", value: (row) => row.searchVolume },
];

export const getKeywordGapTool = {
  name: "get_keyword_gap",
  config: {
    title: "Get keyword gap",
    description:
      "Compare ranked keywords for a base domain against 1-4 competitors. Reuses cached snapshots when available. If the comparison will spend credits, pass the approved maxCostCredits from estimate_keyword_gap. Charges one Labs ranked-keywords snapshot per uncached domain.",
    inputSchema: {
      ...compareInputSchema,
      maxCostCredits: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Approved credit ceiling from estimate_keyword_gap. Required when billedDomainCount > 0.",
        ),
      classifications: z
        .array(z.enum(KEYWORD_GAP_CLASSIFICATIONS))
        .optional()
        .describe("Optional classification filter."),
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
    async (
      args: CompareArgs & {
        maxCostCredits?: number;
        classifications?: (typeof KEYWORD_GAP_CLASSIFICATIONS)[number][];
      },
      context,
    ) => {
      const input = await resolveCompareInput(args, context);
      const result = await KeywordGapService.run(
        {
          ...input,
          projectId: args.projectId,
          maxCostCredits: args.maxCostCredits,
          filters: { classifications: args.classifications },
        },
        context.billing,
      );
      const preview = result.rows.slice(0, 25);
      return mcpResponse({
        text: [
          `Keyword gap for ${result.baseDomain} vs ${(result.competitorDomains ?? []).join(", ")}: ${result.totalCount} keywords.`,
          preview.length === 0
            ? "No keywords matched."
            : formatMcpTable(preview, resultColumns),
        ].join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/keyword-gap`,
        ),
        structuredContent: result,
      });
    },
  ),
};
