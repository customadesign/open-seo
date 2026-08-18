import { z } from "zod";
import { KeywordResearchService } from "@/server/features/keywords/services/KeywordResearchService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { resolveMarket } from "@/shared/keyword-locations";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { assertLanguageForLocation } from "@/server/lib/market";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";
import {
  KEYWORD_MAGIC_DEFAULT_KEYWORDS,
  KEYWORD_MAGIC_MATCH_TYPE_LABELS,
} from "@/shared/keyword-magic";

const inputSchema = {
  projectId: projectIdSchema,
  seed: z.string().min(1).describe("Seed keyword to expand and cluster."),
  locationCode: locationCodeSchema.optional(),
  languageCode: languageCodeSchema.optional(),
  maxKeywords: z
    .union([
      z.literal(1000),
      z.literal(5000),
      z.literal(10000),
      z.literal(20000),
    ])
    .optional()
    .describe("Cap on persisted keywords. Defaults to 10000."),
  includeClickstreamData: z
    .boolean()
    .optional()
    .describe(
      "Refine volumes with clickstream data. DOUBLES credit cost. Default false.",
    ),
  matchType: z
    .enum(["all", "broad", "phrase", "exact", "related", "questions"])
    .optional()
    .describe(
      "All / Broad / Phrase / Exact / Related / Questions. Defaults to all.",
    ),
  maxCostCredits: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .optional()
    .describe(
      "Approved credit ceiling. Required when the seed is not already cached. Call once without it to see the estimate in the error, or estimate first via a dry run with maxKeywords.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

type ClusterRow = {
  cluster: string;
  keywords: number;
};

const CLUSTER_COLUMNS: McpTableColumn<ClusterRow>[] = [
  { header: "cluster", value: (row) => row.cluster },
  { header: "keywords", value: (row) => row.keywords },
];

export const researchKeywordClustersTool = {
  name: "research_keyword_clusters",
  config: {
    title: "Research clustered keywords",
    description:
      "Expand a seed into a persisted Keyword Magic result set (up to 20,000 keywords), group them into named topic clusters, and return cluster counts plus a page of keywords. Re-filtering a cached seed is free. A broad seed fans out across Labs suggestion pages — pass maxCostCredits after showing the estimate. Google Ads-only countries return volume/CPC without KD, intent, or SERP features.",
    inputSchema,
    outputSchema: {
      runId: z.string(),
      seed: z.string(),
      keywordCount: z.number(),
      cached: z.boolean(),
      clusters: z.array(looseObjectOutputSchema),
      rows: z.array(looseObjectOutputSchema),
      matchType: z.string(),
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const { locationCode, languageCode } = resolveMarket(args, context.project);
    assertLanguageForLocation(locationCode, languageCode);
    const matchType = args.matchType ?? "all";

    const estimate = await KeywordResearchService.estimateKeywordMagic(
      {
        projectId: args.projectId,
        seed: args.seed,
        locationCode,
        languageCode,
        clickstream: args.includeClickstreamData ?? false,
        maxKeywords: args.maxKeywords ?? KEYWORD_MAGIC_DEFAULT_KEYWORDS,
      },
      context.billing,
    );
    if (!estimate.cached && args.maxCostCredits == null) {
      throw new Error(
        `This seed costs an estimated ${estimate.costCredits} credits (${estimate.requests} Labs requests). Show that estimate, then retry with maxCostCredits set to the approved amount.`,
      );
    }

    const run = await KeywordResearchService.runKeywordMagic(
      {
        projectId: args.projectId,
        seed: args.seed,
        locationCode,
        languageCode,
        clickstream: args.includeClickstreamData ?? false,
        maxKeywords: args.maxKeywords ?? KEYWORD_MAGIC_DEFAULT_KEYWORDS,
        maxCostCredits: args.maxCostCredits,
      },
      context.billing,
    );

    const page = await KeywordResearchService.getKeywordMagicPage({
      projectId: args.projectId,
      runId: run.id,
      filters: { matchType },
      page: 1,
      pageSize: 50,
      sort: "searchVolume",
      order: "desc",
    });

    const clusterRows = page.clusters.map((cluster) => ({
      cluster: cluster.name,
      keywords: cluster.keywordCount,
    }));
    const header = `"${run.seed}" — ${run.keywordCount} keywords in ${page.clusters.length} clusters (${KEYWORD_MAGIC_MATCH_TYPE_LABELS[matchType]}${estimate.cached ? ", cached" : ""})`;
    const text = `${header}\n${formatMcpTable(clusterRows, CLUSTER_COLUMNS)}\n\nTop keywords (volume desc):\n${page.rows
      .slice(0, 20)
      .map(
        (row) =>
          `${row.keyword} — vol ${row.searchVolume ?? "—"}, KD ${row.keywordDifficulty ?? "—"}`,
      )
      .join("\n")}`;

    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/keywords?q=${encodeURIComponent(run.seed)}&run=${run.id}`,
      ),
      structuredContent: {
        runId: run.id,
        seed: run.seed,
        keywordCount: run.keywordCount,
        cached: estimate.cached,
        clusters: page.clusters,
        rows: page.rows,
        matchType,
      },
    });
  }),
};
