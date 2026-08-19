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
import { COMMERCIAL_ANCHOR_SHARE_THRESHOLD } from "@/shared/backlinks";
import { backlinksTargetScopeSchema } from "@/types/schemas/backlinks";

const ANCHOR_COLUMNS: McpTableColumn<{
  anchor?: string | null;
  referringDomains?: number | null;
  backlinks?: number | null;
  share?: number;
  kind?: string;
  concentrated?: boolean;
}>[] = [
  { header: "anchor", value: (row) => row.anchor || "(empty)" },
  { header: "referring domains", value: (row) => row.referringDomains },
  { header: "backlinks", value: (row) => row.backlinks },
  {
    header: "share",
    value: (row) =>
      typeof row.share === "number" ? `${(row.share * 100).toFixed(1)}%` : "?",
  },
  { header: "kind", value: (row) => row.kind },
  {
    header: "concentrated",
    value: (row) => (row.concentrated ? "yes" : "no"),
  },
];

const inputSchema = {
  projectId: projectIdSchema,
  target: z
    .string()
    .min(1)
    .max(2048)
    .describe(
      "Domain or URL to analyze (e.g. 'example.com' or 'https://example.com/blog').",
    ),
  scope: backlinksTargetScopeSchema
    .optional()
    .describe(
      "'domain' analyzes the whole domain; 'page' analyzes a specific URL. Defaults to 'domain'.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getBacklinksAnchorsTool = {
  name: "get_backlinks_anchors",
  config: {
    title: "Get backlinks anchors",
    description:
      "Returns the cached-or-fetched anchor-text distribution for a domain or page: each anchor, referring domains, backlinks, share of the fetched total, and whether a commercial/keyword anchor exceeds the 15% concentration threshold. Re-sorting the result does not re-bill. Charges credits on a cache miss (~20 typical). Self-hosted deployments need the Backlinks API enabled.",
    inputSchema,
    outputSchema: {
      anchors: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const anchors = await BacklinksService.profileAnchors(
      { target: args.target, scope: args.scope },
      context.billing,
    );
    const concentration =
      anchors.concentratedAnchors.length === 0
        ? `No commercial/keyword anchor exceeds ${(COMMERCIAL_ANCHOR_SHARE_THRESHOLD * 100).toFixed(0)}% of fetched backlinks.`
        : `Concentrated commercial anchors (>= ${(COMMERCIAL_ANCHOR_SHARE_THRESHOLD * 100).toFixed(0)}% share): ${anchors.concentratedAnchors.join(", ")}`;
    const text = [
      `Anchor distribution for ${args.target} (${args.scope ?? "domain"}):`,
      `- rows: ${anchors.rows.length}`,
      `- total anchors in index: ${anchors.totalCount ?? "?"}`,
      `- fetched backlinks: ${anchors.totalBacklinks}`,
      `- ${concentration}`,
      "",
      anchors.rows.length === 0
        ? "No anchors found."
        : formatMcpTable(anchors.rows, ANCHOR_COLUMNS),
    ].join("\n");
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/backlinks`,
        { target: args.target, tab: "anchors" },
      ),
      structuredContent: { anchors },
    });
  }),
};
