import { z } from "zod";
import { OnPageService } from "@/server/features/on-page/services/OnPageService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  ON_PAGE_BUCKET_LABELS,
  ON_PAGE_PRIORITY_LABELS,
  isOnPageBucket,
  isOnPagePriority,
} from "@/shared/on-page";

const inputSchema = {
  projectId: projectIdSchema,
  pageId: z
    .string()
    .min(1)
    .max(160)
    .optional()
    .describe("When set, return ideas for this target page only."),
  includeResolved: z
    .boolean()
    .optional()
    .describe(
      "Include ideas that a later run no longer detected. Default false.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getOnPageIdeasTool = {
  name: "get_on_page_ideas",
  config: {
    title: "Get on-page SEO ideas",
    description:
      "Read stored on-page optimization ideas for a project or one target page. Ideas come from the latest checker run (technical issues from the last completed site audit, content gaps vs the current top 10, and strategy conflicts). Free — reads OpenSEO state. Does not fetch SERPs or start a run.",
    inputSchema,
    outputSchema: {
      totalIdeas: z.number(),
      byBucket: z.record(z.string(), z.number()),
      ideas: z.array(looseObjectOutputSchema),
      audit: looseObjectOutputSchema.nullable(),
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    if (args.pageId) {
      const detail = await OnPageService.getPageDetail(
        args.projectId,
        args.pageId,
      );
      const ideas = detail.ideas.filter(
        (idea) => args.includeResolved || idea.resolvedAt == null,
      );
      const byBucket: Record<string, number> = {};
      for (const idea of ideas) {
        byBucket[idea.bucket] = (byBucket[idea.bucket] ?? 0) + 1;
      }
      const text =
        ideas.length === 0
          ? `No on-page ideas for ${detail.page.url}.`
          : [
              `${ideas.length} on-page ideas for ${detail.page.url}:`,
              ...ideas.slice(0, 40).map((idea) => {
                const priority = isOnPagePriority(idea.priority)
                  ? ON_PAGE_PRIORITY_LABELS[idea.priority]
                  : idea.priority;
                return `- [${priority}] ${idea.title}${idea.keyword ? ` (“${idea.keyword}”)` : ""} — ${idea.summary}`;
              }),
            ].join("\n");
      return mcpResponse({
        text,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/on-page?page=${detail.page.id}`,
        ),
        structuredContent: {
          totalIdeas: ideas.length,
          byBucket,
          ideas,
          audit: detail.audit,
        },
      });
    }

    const overview = await OnPageService.getOverview(args.projectId);
    const lines = overview.targets
      .filter((page) => page.ideaCount > 0)
      .slice(0, 20)
      .map((page) => `- ${page.url}: ${page.ideaCount} ideas`);
    const text =
      overview.targets.length === 0
        ? "No target pages yet. Import rank-tracking URLs or add a page and keyword, then run the checker."
        : [
            `${overview.totalIdeas} unresolved on-page ideas across ${overview.targets.length} target pages.`,
            ...Object.entries(overview.byBucket)
              .filter(([, count]) => count > 0)
              .map(
                ([bucket, count]) =>
                  `- ${isOnPageBucket(bucket) ? ON_PAGE_BUCKET_LABELS[bucket] : bucket}: ${count}`,
              ),
            lines.length > 0 ? "Top pages:" : "",
            ...lines,
          ]
            .filter(Boolean)
            .join("\n");
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/on-page`,
      ),
      structuredContent: {
        totalIdeas: overview.totalIdeas,
        byBucket: overview.byBucket,
        ideas: overview.targets,
        audit: overview.audit,
      },
    });
  }),
};
