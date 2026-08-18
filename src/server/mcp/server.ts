import {
  type CallToolResult,
  McpServer,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
  createMcpToolContext,
  type McpProps,
  type ToolContext,
} from "@/server/mcp/context";
import { objectSchema } from "@/server/mcp/output-schemas";
import { instrumentMcpToolHandler } from "@/server/mcp/instrumentation";
import { analyzeBacklinksBulkTool } from "@/server/mcp/tools/analyze-backlinks-bulk";
import { estimateBacklinksBulkAnalysisTool } from "@/server/mcp/tools/estimate-backlinks-bulk";
import { getBacklinksAnchorsTool } from "@/server/mcp/tools/get-backlinks-anchors";
import { getBacklinksOverviewTool } from "@/server/mcp/tools/get-backlinks-overview";
import { getBacklinksProfileTool } from "@/server/mcp/tools/get-backlinks-profile";
import { getDomainKeywordSuggestionsTool } from "@/server/mcp/tools/get-domain-keyword-suggestions";
import { getDomainOverviewTool } from "@/server/mcp/tools/get-domain-overview";
import { addRankTrackingKeywordsTool } from "@/server/mcp/tools/add-rank-tracking-keywords";
import { createRankTrackerTool } from "@/server/mcp/tools/create-rank-tracker";
import { estimateRankTrackerCostTool } from "@/server/mcp/tools/estimate-rank-tracker-cost";
import { getRankTrackerTool } from "@/server/mcp/tools/get-rank-tracker";
import { getRankCannibalizationTool } from "@/server/mcp/tools/get-rank-cannibalization";
import { getRankingsDistributionTool } from "@/server/mcp/tools/get-rankings-distribution";
import { removeRankTrackingKeywordsTool } from "@/server/mcp/tools/remove-rank-tracking-keywords";
import { runRankTrackerTool } from "@/server/mcp/tools/run-rank-tracker";
import { getSerpResultsTool } from "@/server/mcp/tools/get-serp-results";
import {
  getGoogleAnalyticsAudienceBreakdownTool,
  getGoogleAnalyticsEcommercePerformanceTool,
  getGoogleAnalyticsKeyEventsTool,
  getGoogleAnalyticsMeasurementHealthTool,
  getGoogleAnalyticsOrganicLandingPagesTool,
  getGoogleAnalyticsOrganicOverviewTool,
  getGoogleAnalyticsPagePerformanceTool,
  getGoogleAnalyticsSiteSearchTool,
  getGoogleAnalyticsTrafficAcquisitionTool,
  getSearchOpportunitiesTool,
} from "@/server/mcp/tools/google-analytics-tools";
import { createProjectTool } from "@/server/mcp/tools/create-project";
import { listProjectsTool } from "@/server/mcp/tools/list-projects";
import { listSavedKeywordsTool } from "@/server/mcp/tools/list-saved-keywords";
import {
  findSerpCompetitorsTool,
  getGoogleBusinessQuestionsTool,
  getKeywordMetricsTool,
  getLocalSerpResultsTool,
  getRankedKeywordsTool,
  searchLocalBusinessesTool,
} from "@/server/mcp/tools/dataforseo-research-tools";
import { researchKeywordsTool } from "@/server/mcp/tools/research-keywords";
import { researchKeywordClustersTool } from "@/server/mcp/tools/research-keyword-clusters";
import { saveKeywordsTool } from "@/server/mcp/tools/save-keywords";
import {
  getSearchConsolePerformanceTool,
  inspectUrlsTool,
} from "@/server/mcp/tools/search-console-tools";
import { getOrganicTrafficInsightsTool } from "@/server/mcp/tools/traffic-insights-tools";
import { getCrawlBudgetTool } from "@/server/mcp/tools/get-crawl-budget";
import {
  getAuditIssuesTool,
  getAuditPagesTool,
  getAuditStatusTool,
  runSiteAuditTool,
} from "@/server/mcp/tools/site-audit-tools";
import { whoamiTool } from "@/server/mcp/tools/whoami";
import {
  getCitationAuditsTool,
  getGeoGridHistoryTool,
  getLocalListingStatusTool,
  recordCitationEvidenceTool,
  runCitationAuditTool,
  runGeoGridTool,
} from "@/server/mcp/tools/local-seo-tools";
import {
  estimateKeywordGapTool,
  getKeywordGapTool,
} from "@/server/mcp/tools/keyword-gap-tools";
import {
  estimateBacklinkGapTool,
  getBacklinkGapTool,
} from "@/server/mcp/tools/backlink-gap-tools";

type ToolSchema = z.ZodType | z.ZodRawShape;

// Tools declare inputSchema as either a raw Zod shape (most tools) or a full
// z.object (the GA4 tools); both normalize to one object schema at
// registration.
type ToolArgs<Input extends ToolSchema> = Input extends z.ZodType
  ? z.infer<Input>
  : Input extends z.ZodRawShape
    ? z.infer<z.ZodObject<Input>>
    : never;

type OpenSeoToolDefinition<Input extends ToolSchema> = {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema: Input;
    outputSchema?: ToolSchema;
    annotations?: ToolAnnotations;
  };
  handler: (
    args: ToolArgs<Input>,
    context: ToolContext,
  ) => CallToolResult | Promise<CallToolResult>;
};

function registerOpenSeoTool<Input extends ToolSchema>(
  server: McpServer,
  tool: OpenSeoToolDefinition<Input>,
  authProps: McpProps,
) {
  const outputSchema = objectSchema(tool.config.outputSchema);
  const handler = instrumentMcpToolHandler(
    tool.name,
    outputSchema,
    tool.handler,
  );

  server.registerTool(
    tool.name,
    {
      ...tool.config,
      inputSchema: objectSchema(tool.config.inputSchema),
      outputSchema,
    },
    (args, context) => {
      return handler(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- args were validated against the tool's own inputSchema just above
        args as ToolArgs<Input>,
        createMcpToolContext(context, authProps),
      );
    },
  );
}

export function createOpenSeoMcpServer(authProps: McpProps) {
  const server = new McpServer(
    {
      name: "OpenSEO MCP",
      title: "OpenSEO",
      version: "0.0.12",
      description:
        "SEO research and operations for AI agents: keyword and competitor research, backlinks, rank tracking, local SEO geo-grids and citation evidence, site audits, access-log crawl budget, and Google performance data.",
      websiteUrl: "https://openseo.so",
      icons: [
        {
          src: "https://openseo.so/android-chrome-512x512.png",
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ],
    },
    {
      instructions:
        "OpenSEO research tools use credits. Proceed with normal focused research, but ask the user for confirmation before planned batches over 2,000 credits.",
    },
  );

  const register = <Input extends ToolSchema>(
    tool: OpenSeoToolDefinition<Input>,
  ) => registerOpenSeoTool(server, tool, authProps);

  register(whoamiTool);
  register(listProjectsTool);
  register(createProjectTool);
  register(listSavedKeywordsTool);
  register(researchKeywordsTool);
  register(researchKeywordClustersTool);
  register(saveKeywordsTool);
  register(getDomainOverviewTool);
  register(getDomainKeywordSuggestionsTool);
  register(getBacklinksOverviewTool);
  register(getBacklinksProfileTool);
  register(getBacklinksAnchorsTool);
  register(estimateBacklinksBulkAnalysisTool);
  register(analyzeBacklinksBulkTool);
  register(estimateKeywordGapTool);
  register(getKeywordGapTool);
  register(estimateBacklinkGapTool);
  register(getBacklinkGapTool);
  register(getSerpResultsTool);
  register(createRankTrackerTool);
  register(getRankTrackerTool);
  register(getRankCannibalizationTool);
  register(getRankingsDistributionTool);
  register(addRankTrackingKeywordsTool);
  register(removeRankTrackingKeywordsTool);
  register(estimateRankTrackerCostTool);
  register(runRankTrackerTool);
  register(getRankedKeywordsTool);
  register(findSerpCompetitorsTool);
  register(searchLocalBusinessesTool);
  register(getLocalSerpResultsTool);
  register(getGoogleBusinessQuestionsTool);
  register(getKeywordMetricsTool);
  register(getLocalListingStatusTool);
  register(getGeoGridHistoryTool);
  register(runGeoGridTool);
  register(getCitationAuditsTool);
  register(recordCitationEvidenceTool);
  register(runCitationAuditTool);
  register(getSearchConsolePerformanceTool);
  register(inspectUrlsTool);
  register(getGoogleAnalyticsOrganicLandingPagesTool);
  register(getGoogleAnalyticsPagePerformanceTool);
  register(getGoogleAnalyticsKeyEventsTool);
  register(getSearchOpportunitiesTool);
  register(getOrganicTrafficInsightsTool);
  register(getGoogleAnalyticsOrganicOverviewTool);
  register(getGoogleAnalyticsTrafficAcquisitionTool);
  register(getGoogleAnalyticsMeasurementHealthTool);
  register(getGoogleAnalyticsEcommercePerformanceTool);
  register(getGoogleAnalyticsSiteSearchTool);
  register(getGoogleAnalyticsAudienceBreakdownTool);
  register(runSiteAuditTool);
  register(getAuditStatusTool);
  register(getAuditIssuesTool);
  register(getAuditPagesTool);
  register(getCrawlBudgetTool);

  return server;
}
