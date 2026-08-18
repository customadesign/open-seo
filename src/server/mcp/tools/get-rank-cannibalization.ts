import { z } from "zod";
import { RankTrackingReportService } from "@/server/features/rank-tracking/services/rankTrackingReports";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import {
  formatMcpTable,
  readPath,
  type McpTableColumn,
} from "@/server/mcp/table";
import { projectIdSchema } from "@/server/mcp/schemas";

const FINDING_COLUMNS: McpTableColumn<unknown>[] = [
  { header: "keyword", value: (row) => readPath(row, "keyword") },
  { header: "device", value: (row) => readPath(row, "device") },
  { header: "position", value: (row) => readPath(row, "currentPosition") },
  {
    header: "urls",
    value: (row) => {
      const urls = readPath(row, "competingUrls");
      return Array.isArray(urls) ? urls.length : "—";
    },
  },
  { header: "flips", value: (row) => readPath(row, "transitionCount") },
];

const inputSchema = {
  projectId: projectIdSchema,
  trackerId: z.string().uuid().describe("Rank tracker config ID."),
  device: z
    .enum(["desktop", "mobile"])
    .default("desktop")
    .describe("Device to inspect. Defaults to desktop."),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getRankCannibalizationTool = {
  name: "get_rank_cannibalization",
  config: {
    title: "Get rank cannibalization",
    description:
      "Read-only. Detects tracked keywords whose ranking URL has flipped between two or more project URLs across stored snapshots. A single one-way URL change (redirect or page move) is not reported. Uses no credits. Same-SERP multi-URL cannibalization is not available because snapshots store only the best ranking URL.",
    inputSchema,
    outputSchema: z
      .object({
        findings: z.array(looseObjectOutputSchema),
        scannedKeywords: z.number(),
        runCount: z.number(),
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
    const report = await RankTrackingReportService.getCannibalization(
      args.trackerId,
      args.projectId,
      args.device,
    );
    const text =
      report.findings.length === 0
        ? `No cannibalization found across ${report.scannedKeywords} keywords in ${report.runCount} stored checks.`
        : `Cannibalization (${report.findings.length} of ${report.scannedKeywords} keywords):\n` +
          formatMcpTable(report.findings, FINDING_COLUMNS);
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/rank-tracking/${args.trackerId}`,
      ),
      structuredContent: report,
    });
  }),
};
