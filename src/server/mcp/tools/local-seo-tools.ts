import { z } from "zod";
import { CitationAuditService } from "@/server/features/local-seo/services/CitationAuditService";
import { GeoGridService } from "@/server/features/local-seo/services/GeoGridService";
import { LocalListingService } from "@/server/features/local-seo/services/LocalListingService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  citationAuditsResultSchema,
  geoGridHistoryResultSchema,
  geoGridRunResultSchema,
  localListingStatusResultSchema,
  recordCitationAuditSchema,
  runCitationAuditResultSchema,
} from "@/types/schemas/local-seo";

const localSeoPath = (projectId: string) => `/p/${projectId}/local-seo`;

const listingStatusInputSchema = {
  projectId: projectIdSchema,
  profileId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Business profile ID; omitted uses the project's primary profile.",
    ),
} as const;

type ListingStatusArgs = z.infer<z.ZodObject<typeof listingStatusInputSchema>>;

export const getLocalListingStatusTool = {
  name: "get_local_listing_status",
  config: {
    title: "Get local listing status",
    description:
      "Reads OpenSEO's stored GoHighLevel Listings connection and status evidence for a project business profile. It never calls undocumented GHL/Yext endpoints and explicitly reports that no live provider check occurred. Uses no credits.",
    inputSchema: listingStatusInputSchema,
    outputSchema: {
      listing: localListingStatusResultSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ListingStatusArgs, context) => {
    const listing = await LocalListingService.getListingStatus(
      args.projectId,
      args.profileId,
    );
    const status = listing.connection?.status ?? "not_connected";
    const text = listing.profile
      ? `Stored local listing status for ${listing.profile.name}: ${status}. Verification: ${listing.verification}. No live GHL, Yext, or directory check was performed.`
      : "No local business profile is configured for this project. No live GHL, Yext, or directory check was performed.";
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        localSeoPath(args.projectId),
      ),
      structuredContent: { listing },
    });
  }),
};

const geoGridHistoryInputSchema = {
  projectId: projectIdSchema,
  configId: z.string().uuid().optional(),
  runId: z
    .string()
    .uuid()
    .optional()
    .describe("Specific run ID; when present, cells are included."),
  limit: z.number().int().min(1).max(100).default(20),
} as const;

type GeoGridHistoryArgs = z.infer<
  z.ZodObject<typeof geoGridHistoryInputSchema>
>;

export const getGeoGridHistoryTool = {
  name: "get_geo_grid_history",
  config: {
    title: "Get local geo-grid history",
    description:
      "Reads stored Google Maps geo-grid runs for the authorized project. Pass runId to include every stored grid cell and its evidence-based match method. Uses no credits.",
    inputSchema: geoGridHistoryInputSchema,
    outputSchema: {
      runs: geoGridHistoryResultSchema.shape.runs,
      cells: geoGridHistoryResultSchema.shape.cells,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: GeoGridHistoryArgs, context) => {
    const history = await GeoGridService.getHistory(args);
    const text = args.runId
      ? `Geo-grid run ${args.runId}: ${history.cells.length} stored cells.`
      : `Found ${history.runs.length} stored geo-grid runs.`;
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        localSeoPath(args.projectId),
      ),
      structuredContent: history,
    });
  }),
};

const runGeoGridInputSchema = {
  projectId: projectIdSchema,
  configId: z.string().uuid(),
} as const;

type RunGeoGridArgs = z.infer<z.ZodObject<typeof runGeoGridInputSchema>>;

export const runGeoGridTool = {
  name: "run_local_geo_grid",
  config: {
    title: "Run local geo-grid",
    description:
      "Runs the configured Google Maps geo-grid through OpenSEO's metered DataForSEO client and stores the cells and aggregate coverage. This spends local SEO credits (one live Maps request per grid cell) and must be an explicit user action. If the config already has an active run, returns it without starting or charging another run.",
    inputSchema: runGeoGridInputSchema,
    outputSchema: {
      started: z.boolean(),
      run: geoGridRunResultSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: RunGeoGridArgs, context) => {
    const result = await GeoGridService.runGrid({
      configId: args.configId,
      projectId: args.projectId,
      billingCustomer: context.billing,
    });
    return mcpResponse({
      text: result.started
        ? `Geo-grid run ${result.run.id} completed with ${result.run.cellsCompleted} of ${result.run.cellsTotal} cells.`
        : `Geo-grid run ${result.run.id} is already ${result.run.status}; no duplicate run was started.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        localSeoPath(args.projectId),
      ),
      structuredContent: { started: result.started, run: result.run },
    });
  }),
};

const citationAuditsInputSchema = {
  projectId: projectIdSchema,
  profileId: z.string().uuid().optional(),
  auditRunId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Specific audit run ID; when present, observations are included.",
    ),
  limit: z.number().int().min(1).max(100).default(20),
} as const;

type CitationAuditsArgs = z.infer<
  z.ZodObject<typeof citationAuditsInputSchema>
>;

export const getCitationAuditsTool = {
  name: "get_citation_audits",
  config: {
    title: "Get citation audits",
    description:
      "Reads stored, evidence-based citation audit results for the authorized project. Pass auditRunId for observations and field-level match states. Unknown or blocked evidence remains explicit; this tool does not scrape directories. Uses no credits.",
    inputSchema: citationAuditsInputSchema,
    outputSchema: {
      runs: citationAuditsResultSchema.shape.runs,
      observations: citationAuditsResultSchema.shape.observations,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: CitationAuditsArgs, context) => {
    const audits = await CitationAuditService.getAudits(args);
    return mcpResponse({
      text: args.auditRunId
        ? `Citation audit ${args.auditRunId}: ${audits.observations.length} stored observations.`
        : `Found ${audits.runs.length} stored citation audits.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        localSeoPath(args.projectId),
      ),
      structuredContent: audits,
    });
  }),
};

const recordCitationEvidenceInputSchema = {
  projectId: projectIdSchema,
  profileId: z.string().uuid(),
  observations: recordCitationAuditSchema.shape.observations.describe(
    "Directory observations gathered by a human or authorized agent. Every found observation must include its evidence URL.",
  ),
} as const;

type RecordCitationEvidenceArgs = z.infer<
  z.ZodObject<typeof recordCitationEvidenceInputSchema>
>;

export const recordCitationEvidenceTool = {
  name: "record_citation_evidence",
  config: {
    title: "Record citation evidence",
    description:
      "Stores supplied directory evidence and classifies its NAP fields against the authorized project's canonical business profile. This does not scrape, syndicate, or modify any directory and uses no credits. Unknown, blocked, and not-found observations remain distinct.",
    inputSchema: recordCitationEvidenceInputSchema,
    outputSchema: {
      run: citationAuditsResultSchema.shape.runs.element,
      observations: citationAuditsResultSchema.shape.observations,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: RecordCitationEvidenceArgs, context) => {
      const result = await CitationAuditService.recordAudit(args);
      return mcpResponse({
        text: `Stored ${result.observations.length} citation observations in audit ${result.run.id}.`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          localSeoPath(args.projectId),
        ),
        structuredContent: result,
      });
    },
  ),
};

const runCitationAuditInputSchema = {
  projectId: projectIdSchema,
  profileId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Business profile ID; omitted uses the project's primary profile.",
    ),
  radiusKm: z
    .number()
    .min(1)
    .max(100)
    .default(5)
    .describe("Google Business listing search radius around the profile."),
  resultLimit: z.number().int().min(1).max(100).default(20),
} as const;

type RunCitationAuditArgs = z.infer<
  z.ZodObject<typeof runCitationAuditInputSchema>
>;

export const runCitationAuditTool = {
  name: "run_citation_audit",
  config: {
    title: "Run Google Business citation audit",
    description:
      "Runs one metered DataForSEO Business Listings search near the canonical profile, matches the Google Business result by place ID/CID/phone/domain/name, and stores its NAP evidence. Spends local SEO credits. It checks Google Business only, performs no directory writes, and does not imply coverage of other citation directories.",
    inputSchema: runCitationAuditInputSchema,
    outputSchema: {
      run: runCitationAuditResultSchema.shape.run,
      observations: runCitationAuditResultSchema.shape.observations,
      coverage: runCitationAuditResultSchema.shape.coverage,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: RunCitationAuditArgs, context) => {
    const result = await CitationAuditService.runProviderAudit({
      ...args,
      billingCustomer: context.billing,
    });
    const observation = result.observations[0];
    return mcpResponse({
      text: `Citation audit ${result.run.id} completed. Google Business: ${observation?.status ?? "unknown"}. ${result.coverage.limitation}`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        localSeoPath(args.projectId),
      ),
      structuredContent: result,
    });
  }),
};
