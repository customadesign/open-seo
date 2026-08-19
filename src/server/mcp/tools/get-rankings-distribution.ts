import { z } from "zod";
import { RankTrackingReportService } from "@/server/features/rank-tracking/services/rankTrackingReports";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { RANK_BAND_LABELS, RANK_BANDS } from "@/shared/rank-tracking-reports";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  trackerId: z.string().uuid().describe("Rank tracker config ID."),
  device: z
    .enum(["desktop", "mobile"])
    .default("desktop")
    .describe("Device to inspect. Defaults to desktop."),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getRankingsDistributionTool = {
  name: "get_rankings_distribution",
  config: {
    title: "Get rankings distribution",
    description:
      "Read-only. Counts tracked keywords in each position band (1–3, 4–10, 11–20, 21–100, out of top 100) across stored snapshots, plus keywords that entered or left each band between the two most recent full checks. Uses no credits.",
    inputSchema,
    outputSchema: z
      .object({
        trend: z.array(looseObjectOutputSchema),
        current: looseObjectOutputSchema,
        previous: looseObjectOutputSchema.nullable(),
        movement: looseObjectOutputSchema,
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
    const report = await RankTrackingReportService.getDistribution(
      args.trackerId,
      args.projectId,
      args.device,
    );
    const lines = RANK_BANDS.map((band) => {
      const current = report.current[band];
      const entered = report.movement[band].entered;
      const left = report.movement[band].left;
      return `- ${RANK_BAND_LABELS[band]}: ${current} (entered ${entered}, left ${left})`;
    });
    return mcpResponse({
      text: `Rankings distribution (${args.device}):\n${lines.join("\n")}`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/rank-tracking/${args.trackerId}`,
      ),
      structuredContent: report,
    });
  }),
};
