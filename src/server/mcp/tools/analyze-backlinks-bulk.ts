import { z } from "zod";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { projectIdSchema } from "@/server/mcp/schemas";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import { MAX_BACKLINKS_BULK_TARGETS } from "@/shared/backlinks";

const BULK_COLUMNS: McpTableColumn<{
  displayTarget?: string;
  authorityScore?: number | null;
  referringDomains?: number | null;
  backlinks?: number | null;
  organicTraffic?: number | null;
}>[] = [
  { header: "target", value: (row) => row.displayTarget },
  { header: "authority", value: (row) => row.authorityScore },
  { header: "referring domains", value: (row) => row.referringDomains },
  { header: "backlinks", value: (row) => row.backlinks },
  { header: "organic traffic", value: (row) => row.organicTraffic },
];

const inputSchema = {
  projectId: projectIdSchema,
  targets: z
    .array(z.string().min(1).max(2048))
    .min(1)
    .max(MAX_BACKLINKS_BULK_TARGETS)
    .describe("Domains or URLs to analyze. One to 200 values."),
  maxCostCredits: z
    .number()
    .int()
    .positive()
    .describe(
      "Approved credit ceiling from estimate_backlinks_bulk_analysis. Required before spend.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const analyzeBacklinksBulkTool = {
  name: "analyze_backlinks_bulk",
  config: {
    title: "Analyze backlinks in bulk",
    description:
      "Analyze up to 200 domains or URLs and return authority score, referring domains, backlinks, and organic traffic per row. Requires maxCostCredits from estimate_backlinks_bulk_analysis. Cached fingerprints reuse the snapshot and do not re-bill. Charges credits on a cache miss.",
    inputSchema,
    outputSchema: {
      analysis: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const market = resolveLabsMarket({}, context.project);
    const analysis = await BacklinksService.runBulkAnalysis(
      {
        targets: args.targets,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
        maxCostCredits: args.maxCostCredits,
      },
      context.billing,
    );
    const text = [
      `Bulk backlink analysis (${analysis.rows.length} target${analysis.rows.length === 1 ? "" : "s"}${analysis.fromCache ? ", cached" : ""}):`,
      "",
      analysis.rows.length === 0
        ? "No rows returned."
        : formatMcpTable(analysis.rows, BULK_COLUMNS),
    ].join("\n");
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/backlinks`,
        { tab: "bulk" },
      ),
      structuredContent: { analysis },
    });
  }),
};
