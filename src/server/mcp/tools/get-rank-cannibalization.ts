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

const SAME_SERP_COLUMNS: McpTableColumn<unknown>[] = [
  { header: "keyword", value: (row) => readPath(row, "keyword") },
  { header: "device", value: (row) => readPath(row, "device") },
  { header: "position", value: (row) => readPath(row, "currentPosition") },
  {
    header: "urls",
    value: (row) => {
      const urls = readPath(row, "urls");
      return Array.isArray(urls) ? urls.length : "—";
    },
  },
];

const FLIP_COLUMNS: McpTableColumn<unknown>[] = [
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
      "Read-only. Primary finding: two or more of this project's URLs on one captured SERP. Secondary: the best ranking URL flipped more than once across snapshots (a single redirect is not reported). Uses no credits. Same-SERP data exists only on checks run after SERP entries were stored.",
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
    const sameSerp = report.sameSerp ?? [];
    const urlFlips = report.urlFlips ?? report.findings;
    const sections: string[] = [];
    if (sameSerp.length === 0 && urlFlips.length === 0) {
      sections.push(
        report.capturedRunCount === 0
          ? `No URL-flip cannibalization across ${report.scannedKeywords} keywords in ${report.runCount} stored checks. Same-SERP detection needs a check that stored every ranking URL.`
          : `No cannibalization found across ${report.scannedKeywords} keywords in ${report.runCount} stored checks.`,
      );
    } else {
      if (sameSerp.length > 0) {
        sections.push(
          `Same SERP (${sameSerp.length} of ${report.scannedKeywords} keywords):\n` +
            formatMcpTable(sameSerp, SAME_SERP_COLUMNS),
        );
      }
      if (urlFlips.length > 0) {
        sections.push(
          `URL flips (${urlFlips.length} of ${report.scannedKeywords} keywords):\n` +
            formatMcpTable(urlFlips, FLIP_COLUMNS),
        );
      }
    }
    return mcpResponse({
      text: sections.join("\n\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/rank-tracking/${args.trackerId}`,
      ),
      structuredContent: report,
    });
  }),
};
