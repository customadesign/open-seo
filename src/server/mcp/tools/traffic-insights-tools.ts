import { z } from "zod";
import { OrganicTrafficInsightsService } from "@/server/features/traffic-insights/services/OrganicTrafficInsightsService";
import { SEARCH_PERFORMANCE_RANGES } from "@/types/schemas/search-performance";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { organicTrafficInsightsOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";

const TEXT_SUMMARY_ROWS = 15;

type InsightRow = {
  url: string;
  sessions: number | null;
  clicks: number | null;
  impressions: number | null;
  keywordCount: number | null;
  bestPosition: number | null;
  coverage: string;
};

const COLUMNS: McpTableColumn<InsightRow>[] = [
  { header: "page", value: (row) => row.url },
  { header: "sessions", value: (row) => row.sessions },
  { header: "clicks", value: (row) => row.clicks },
  { header: "impressions", value: (row) => row.impressions },
  { header: "keywords", value: (row) => row.keywordCount },
  {
    header: "best pos.",
    value: (row) => row.bestPosition,
    format: (value) => (typeof value === "number" ? value.toFixed(1) : "—"),
  },
  { header: "sources", value: (row) => row.coverage },
];

const inputSchema = {
  projectId: projectIdSchema,
  dateRange: z
    .enum(SEARCH_PERFORMANCE_RANGES)
    .optional()
    .describe(
      "Convenience window. Default last_28_days. End is lagged for GSC.",
    ),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Explicit start (YYYY-MM-DD). Use with endDate."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Explicit end (YYYY-MM-DD). Use with startDate."),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getOrganicTrafficInsightsTool = {
  name: "get_organic_traffic_insights",
  config: {
    title: "Get organic traffic insights",
    description:
      "Join GA4 organic landing pages, Search Console page/query metrics, and stored rank-tracking snapshots per URL. Missing sources stay visible as not connected rather than zeros. Read-only; uses no credits.",
    inputSchema,
    outputSchema: organicTrafficInsightsOutputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const result = await OrganicTrafficInsightsService.getInsights(args);
    const rows = result.rows.slice(0, TEXT_SUMMARY_ROWS).map((row) => ({
      url: row.url,
      sessions: row.sessions,
      clicks: row.clicks,
      impressions: row.impressions,
      keywordCount: row.keywordCount,
      bestPosition: row.bestPosition,
      coverage: row.coverage.join("+"),
    }));
    const header = `${result.rows.length} landing page${
      result.rows.length === 1 ? "" : "s"
    } · ${result.range.startDate}→${result.range.endDate} · GA4 ${result.sources.ga4.status} · GSC ${result.sources.gsc.status} · ranks ${result.sources.rankTracking.status}`;
    const text =
      rows.length > 0
        ? `${header}\n${formatMcpTable(rows, COLUMNS)}`
        : `${header}\nNo landing pages in the connected sources for this range.`;

    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/traffic-insights`,
      ),
      structuredContent: {
        status: "ok",
        range: result.range,
        sources: result.sources,
        rowCount: result.rows.length,
        rows: result.rows,
        truncated: result.truncated,
      },
    });
  }),
};
