import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import type { localBusinessProfiles } from "@/db/schema";
import {
  citationAuditRuns,
  citationObservations,
  geoGridCells,
  geoGridConfigs,
  geoGridRuns,
  localListingConnections,
} from "@/db/schema";
import { isSupportedLanguageCode } from "@/shared/keyword-locations";

export type LocalBusinessProfile = InferSelectModel<
  typeof localBusinessProfiles
>;
export type LocalListingConnection = InferSelectModel<
  typeof localListingConnections
>;
export type GeoGridConfig = InferSelectModel<typeof geoGridConfigs>;

const projectIdField = z.string().uuid();
const optionalTrimmedString = z.string().trim().min(1).nullable().optional();
const latitudeField = z.number().min(-85).max(85);
const longitudeField = z.number().min(-180).max(180);
function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
const httpUrlField = z
  .string()
  .url()
  .max(2048)
  .refine(isHttpUrl, { message: "URL must use HTTP or HTTPS" });
const languageCodeField = z
  .string()
  .trim()
  .min(2)
  .max(10)
  .refine(isSupportedLanguageCode, "Unsupported language code");

const listingEngineSchema = z.enum(localListingConnections.engine.enumValues);
const listingStatusSchema = z.enum(localListingConnections.status.enumValues);
const listingStatusSourceSchema = z.enum(
  localListingConnections.statusSource.enumValues,
);
const geoGridDeviceSchema = z.enum(geoGridConfigs.device.enumValues);
const geoGridScheduleSchema = z.enum(
  geoGridConfigs.scheduleInterval.enumValues,
);
const geoGridRunStatusSchema = z.enum(geoGridRuns.status.enumValues);
export const geoGridMatchedBySchema = z.enum(geoGridCells.matchedBy.enumValues);
export type GeoGridMatchedBy = z.infer<typeof geoGridMatchedBySchema>;
const citationStatusSchema = z.enum(citationObservations.status.enumValues);

export const getLocalBusinessProfilesSchema = z.object({
  projectId: projectIdField,
});

export const saveLocalBusinessProfileSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().min(1).max(300),
  addressLine2: optionalTrimmedString,
  locality: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(24),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  phone: z.string().trim().min(5).max(40),
  websiteUrl: httpUrlField,
  latitude: latitudeField,
  longitude: longitudeField,
  googlePlaceId: optionalTrimmedString,
  googleCid: optionalTrimmedString,
  isPrimary: z.boolean().default(true),
  verifiedAt: z.string().datetime().nullable().optional(),
});

export const getLocalListingStatusSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid().optional(),
});

export const saveLocalListingConnectionSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid(),
  ghlLocationId: z.string().trim().min(1).max(100),
  engine: listingEngineSchema.default("unknown"),
  status: listingStatusSchema.default("setup_required"),
  managementUrl: httpUrlField,
  lastError: z.string().trim().max(1000).nullable().optional(),
});

export const createGeoGridConfigSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid(),
  keyword: z.string().trim().min(1).max(120),
  centerLatitude: latitudeField,
  centerLongitude: longitudeField,
  gridSize: z
    .number()
    .int()
    .min(3)
    .max(11)
    .refine((value) => value % 2 === 1, {
      message: "Grid size must be odd so it has a center cell",
    })
    .default(5),
  radiusMeters: z.number().int().min(100).max(50_000).default(5_000),
  languageCode: languageCodeField.default("en"),
  device: geoGridDeviceSchema.default("mobile"),
  scheduleInterval: geoGridScheduleSchema.default("manual"),
});

export const getGeoGridConfigsSchema = z.object({
  projectId: projectIdField,
});

export const getGeoGridHistorySchema = z.object({
  projectId: projectIdField,
  configId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const runGeoGridSchema = z.object({
  projectId: projectIdField,
  configId: z.string().uuid(),
});

const citationEvidenceKindSchema = z.enum(["found", "not_found", "blocked"]);

const citationEvidenceSchema = z
  .object({
    directoryKey: z.string().trim().min(1).max(120),
    sourceUrl: httpUrlField.nullable().optional(),
    evidenceKind: citationEvidenceKindSchema,
    observedName: optionalTrimmedString,
    observedAddress: optionalTrimmedString,
    observedPhone: optionalTrimmedString,
    observedWebsiteUrl: httpUrlField.nullable().optional(),
    evidenceNote: z.string().trim().max(2000).nullable().optional(),
    errorCode: z.string().trim().max(120).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.evidenceKind !== "found") return;
    if (value.sourceUrl != null) return;
    context.addIssue({
      code: "custom",
      path: ["sourceUrl"],
      message: "Found citation evidence must include its source URL",
    });
  });

export const recordCitationAuditSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid(),
  observations: z
    .array(citationEvidenceSchema)
    .min(1)
    .max(500)
    .superRefine((observations, context) => {
      const seen = new Set<string>();
      observations.forEach((observation, index) => {
        const key = `${observation.directoryKey.toLowerCase()}\u0000${observation.sourceUrl ?? ""}`;
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message:
              "Each directory and evidence URL may appear only once per audit",
          });
        }
        seen.add(key);
      });
    }),
});

export const runCitationAuditSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid().optional(),
  radiusKm: z.number().min(1).max(100).default(5),
  resultLimit: z.number().int().min(1).max(100).default(20),
});

export const getCitationAuditsSchema = z.object({
  projectId: projectIdField,
  profileId: z.string().uuid().optional(),
  auditRunId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const localBusinessProfileResultSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  locality: z.string(),
  region: z.string(),
  postalCode: z.string(),
  countryCode: z.string(),
  phone: z.string(),
  websiteUrl: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  googlePlaceId: z.string().nullable(),
  googleCid: z.string().nullable(),
  isPrimary: z.boolean(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const localListingConnectionResultSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  provider: z.literal("ghl_listings"),
  ghlLocationId: z.string(),
  engine: listingEngineSchema,
  status: listingStatusSchema,
  statusSource: listingStatusSourceSchema,
  managementUrl: z.string(),
  lastVerifiedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const localListingStatusResultSchema = z.object({
  profile: localBusinessProfileResultSchema.nullable(),
  connection: localListingConnectionResultSchema.nullable(),
  verification: z.enum(["not_configured", "unverified", "stored_evidence"]),
  liveProviderCheckPerformed: z.literal(false),
});

export const geoGridRunResultSchema = z.object({
  id: z.string(),
  configId: z.string(),
  projectId: z.string(),
  status: geoGridRunStatusSchema,
  gridSize: z.number().int(),
  radiusMeters: z.number().int(),
  cellsTotal: z.number().int().nonnegative(),
  cellsCompleted: z.number().int().nonnegative(),
  averageRank: z.number().nullable(),
  topThreeCoverage: z.number().min(0).max(1).nullable(),
  topTenCoverage: z.number().min(0).max(1).nullable(),
  topTwentyCoverage: z.number().min(0).max(1).nullable(),
  costUsd: z.number().nonnegative().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

const geoGridCellResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  rowIndex: z.number().int().nonnegative(),
  columnIndex: z.number().int().nonnegative(),
  latitude: z.number(),
  longitude: z.number(),
  position: z.number().int().positive().nullable(),
  matchedBy: geoGridMatchedBySchema,
  resultTitle: z.string().nullable(),
  resultUrl: z.string().nullable(),
  providerResultId: z.string().nullable(),
  checkedAt: z.string(),
});

export const geoGridHistoryResultSchema = z.object({
  runs: z.array(geoGridRunResultSchema),
  cells: z.array(geoGridCellResultSchema),
});

export const geoGridAggregateResultSchema = z.object({
  cellsTotal: z.number().int().nonnegative(),
  cellsRanked: z.number().int().nonnegative(),
  averageRank: z.number().nullable(),
  topThreeCoverage: z.number().min(0).max(1),
  topTenCoverage: z.number().min(0).max(1),
  topTwentyCoverage: z.number().min(0).max(1),
});

export const citationClassificationResultSchema = z.object({
  status: citationStatusSchema,
  nameMatches: z.boolean().nullable(),
  addressMatches: z.boolean().nullable(),
  phoneMatches: z.boolean().nullable(),
  websiteMatches: z.boolean().nullable(),
});

const citationAuditRunResultSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  profileId: z.string(),
  status: z.enum(citationAuditRuns.status.enumValues),
  observationsTotal: z.number().int().nonnegative(),
  confirmedMatches: z.number().int().nonnegative(),
  confirmedMismatches: z.number().int().nonnegative(),
  foundUnverified: z.number().int().nonnegative(),
  notFound: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

const citationObservationResultSchema = z.object({
  id: z.string(),
  auditRunId: z.string(),
  directoryKey: z.string(),
  sourceUrl: z.string().nullable(),
  status: citationStatusSchema,
  observedName: z.string().nullable(),
  observedAddress: z.string().nullable(),
  observedPhone: z.string().nullable(),
  observedWebsiteUrl: z.string().nullable(),
  nameMatches: z.boolean().nullable(),
  addressMatches: z.boolean().nullable(),
  phoneMatches: z.boolean().nullable(),
  websiteMatches: z.boolean().nullable(),
  evidenceNote: z.string().nullable(),
  errorCode: z.string().nullable(),
  checkedAt: z.string(),
});

export const citationAuditsResultSchema = z.object({
  runs: z.array(citationAuditRunResultSchema),
  observations: z.array(citationObservationResultSchema),
});

const citationProviderCoverageSchema = z.object({
  provider: z.literal("dataforseo_business_listings"),
  checkedDirectoryKeys: z.tuple([z.literal("google_business")]),
  multiDirectoryCoverage: z.literal(false),
  limitation: z.string(),
});

export const runCitationAuditResultSchema = z.object({
  run: citationAuditRunResultSchema,
  observations: z.array(citationObservationResultSchema),
  coverage: citationProviderCoverageSchema,
});
