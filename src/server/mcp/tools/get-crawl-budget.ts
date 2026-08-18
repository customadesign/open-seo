import { z } from "zod";
import { LogFileService } from "@/server/features/log-files/services/LogFileService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getCrawlBudgetTool = {
  name: "get_crawl_budget",
  config: {
    title: "Get crawl budget from log files",
    description:
      "Summarize verified search and AI crawler request volume per bot per day from the project's most recent uploaded access log. Free — reads stored log aggregates, not live crawl data.",
    inputSchema,
    outputSchema: z
      .object({
        uploadId: z.string(),
        dateFrom: z.string().nullable(),
        dateTo: z.string().nullable(),
        linesParsed: z.number(),
        linesSkipped: z.number(),
        bots: z.array(looseObjectOutputSchema),
        crawlBudget: z.array(looseObjectOutputSchema),
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
    const summary = await LogFileService.getCrawlBudgetSummary(
      args.projectId,
      context.project.domain,
    );
    const botLines = summary.bots.map(
      (bot) =>
        `- ${bot.label}: ${bot.verifiedRequests} verified / ${bot.requests} claimed requests`,
    );
    const dayLines = summary.crawlBudget
      .slice(0, 30)
      .map(
        (row) =>
          `- ${row.day} ${row.label}: ${row.verifiedRequests}/${row.requests}`,
      );
    return mcpResponse({
      text: [
        `Log ${summary.uploadId}: ${summary.linesParsed} parsed, ${summary.linesSkipped} skipped (${summary.dateFrom ?? "?"} to ${summary.dateTo ?? "?"}).`,
        "Bots:",
        ...(botLines.length > 0 ? botLines : ["- none"]),
        "Daily crawl budget:",
        ...(dayLines.length > 0 ? dayLines : ["- none"]),
      ].join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/log-files`,
      ),
      structuredContent: summary,
    });
  }),
};
