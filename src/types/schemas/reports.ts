/* eslint-disable max-lines -- one schema per report section, kept together so the discriminated union and its members stay in one place. */
import { z } from "zod";
import { REPORT_SECTION_KEYS } from "@/shared/report-sections";
import {
  cannibalizationSchema,
  rankBandCountSchema,
  rankBandMoveSchema,
} from "./report-rankings";

export const reportSectionKeySchema = z.enum(REPORT_SECTION_KEYS);
export const reportCommentaryKindSchema = z.enum([
  "overview",
  "win",
  "watch",
  "next_step",
]);

const idField = z.string().min(1).max(160);
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeField = z.string().datetime({ offset: true });

const reportSectionSettingSchema = z.object({
  key: reportSectionKeySchema,
  enabled: z.boolean(),
});

export const listReportsSchema = z.object({ projectId: idField });
export const getReportRunSchema = z.object({
  projectId: idField,
  runId: idField,
});
export const updateReportSettingsSchema = z.object({
  projectId: idField,
  isEnabled: z.boolean(),
  timeZone: z.string().trim().min(1).max(100),
  runDay: z.number().int().min(1).max(28).default(4),
  runHour: z.number().int().min(0).max(23).default(9),
  sections: z
    .array(reportSectionSettingSchema)
    .length(REPORT_SECTION_KEYS.length)
    .refine(
      (sections) =>
        new Set(sections.map((section) => section.key)).size ===
        REPORT_SECTION_KEYS.length,
      "Report sections must be unique.",
    ),
});
export const generateReportSchema = z.object({
  projectId: idField,
  periodStart: dateField.optional(),
  periodEnd: dateField.optional(),
});
export const retryReportSchema = z.object({
  projectId: idField,
  runId: idField,
});
export const updateReportCommentarySchema = z.object({
  projectId: idField,
  runId: idField,
  items: z
    .array(
      z.object({
        kind: reportCommentaryKindSchema,
        text: z.string().trim().min(1).max(2_000),
        evidenceKey: z.string().trim().min(1).max(160).nullable().optional(),
      }),
    )
    .min(1)
    .max(12),
});

const comparisonMetricSchema = z.object({
  current: z.number().nullable(),
  previous: z.number().nullable(),
  change: z.number().nullable(),
  percentChange: z.number().nullable(),
});

const rankingsSectionSchema = z.object({
  configs: z.array(
    z.object({
      configId: z.string(),
      domain: z.string(),
      locationName: z.string().nullable(),
      devices: z.string(),
      checkedAt: z.string().nullable(),
      summary: z.object({
        tracked: z.number().int(),
        top3: z.number().int(),
        top10: z.number().int(),
        top20: z.number().int(),
        improved: z.number().int(),
        declined: z.number().int(),
        newRankings: z.number().int(),
        lostRankings: z.number().int(),
      }),
      rows: z.array(
        z.object({
          keyword: z.string(),
          device: z.enum(["desktop", "mobile"]),
          position: z.number().nullable(),
          previousPosition: z.number().nullable(),
          change: z.number().nullable(),
          rankingUrl: z.string().nullable(),
        }),
      ),
      trend: z.array(
        z.object({
          checkedAt: z.string(),
          device: z.enum(["desktop", "mobile"]),
          total: z.number().int(),
          top3: z.number().int(),
          top10: z.number().int(),
          top20: z.number().int(),
        }),
      ),
      distribution: z
        .object({
          current: rankBandCountSchema,
          previous: rankBandCountSchema.nullable(),
          movement: z.object({
            top3: rankBandMoveSchema,
            top4to10: rankBandMoveSchema,
            top11to20: rankBandMoveSchema,
            top21to100: rankBandMoveSchema,
            notInTop100: rankBandMoveSchema,
          }),
        })
        .optional(),
      cannibalization: cannibalizationSchema.optional(),
    }),
  ),
});

const gscSectionSchema = z.object({
  siteUrl: z.string(),
  metrics: z.object({
    clicks: comparisonMetricSchema,
    impressions: comparisonMetricSchema,
    ctr: comparisonMetricSchema,
    position: comparisonMetricSchema,
  }),
  trend: z.array(
    z.object({
      date: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      ctr: z.number(),
      position: z.number(),
    }),
  ),
  topQueries: z.array(
    z.object({
      query: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      ctr: z.number(),
      position: z.number(),
    }),
  ),
  topPages: z.array(
    z.object({
      page: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      ctr: z.number(),
      position: z.number(),
    }),
  ),
  opportunities: z.array(
    z.object({
      query: z.string(),
      page: z.string(),
      impressions: z.number(),
      position: z.number(),
    }),
  ),
});

const ga4SectionSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  currencyCode: z.string(),
  metrics: z.record(z.string(), comparisonMetricSchema),
  trend: z.array(z.record(z.string(), z.string().or(z.number()).nullable())),
  topLandingPages: z.array(
    z.record(z.string(), z.string().or(z.number()).nullable()),
  ),
  channels: z.array(z.record(z.string(), z.string().or(z.number()).nullable())),
  keyEvents: z.array(
    z.record(z.string(), z.string().or(z.number()).nullable()),
  ),
  warnings: z.array(z.string()),
});

const googleAdsSectionSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  currencyCode: z.string(),
  metrics: z.object({
    cost: comparisonMetricSchema,
    impressions: comparisonMetricSchema,
    clicks: comparisonMetricSchema,
    ctr: comparisonMetricSchema,
    averageCpc: comparisonMetricSchema,
    conversions: comparisonMetricSchema,
    costPerConversion: comparisonMetricSchema,
    conversionValue: comparisonMetricSchema,
    roas: comparisonMetricSchema,
  }),
  trend: z.array(
    z.object({
      date: z.string(),
      cost: z.number(),
      clicks: z.number(),
      impressions: z.number(),
      conversions: z.number(),
      conversionValue: z.number(),
    }),
  ),
  campaigns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      cost: z.number(),
      clicks: z.number(),
      impressions: z.number(),
      ctr: z.number(),
      conversions: z.number(),
      costPerConversion: z.number().nullable(),
      conversionValue: z.number(),
    }),
  ),
});

const auditSectionSchema = z.object({
  auditId: z.string(),
  status: z.string(),
  pagesCrawled: z.number(),
  completedAt: z.string().nullable(),
  issues: z.array(
    z.object({
      issueType: z.string(),
      severity: z.string(),
      affectedPages: z.number(),
    }),
  ),
});

const backlinksSectionSchema = z.object({
  domain: z.string(),
  domainRank: z.number().nullable(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  newBacklinks: z.number().nullable(),
  lostBacklinks: z.number().nullable(),
  capturedAt: z.string(),
});

/**
 * Both stored-data sections report the newest completed run on or before the
 * period end, which can be older than the period itself. Rather than silently
 * presenting last quarter's numbers as this month's, every such section carries
 * when the data was captured and whether it predates the period.
 */
const sectionFreshnessSchema = z.object({
  capturedAt: z.string(),
  /** Whole days between capture and the end of the reporting period. */
  ageDays: z.number().int(),
  /** True when the newest stored run finished before the period even started. */
  isStale: z.boolean(),
});

/**
 * Counts only. There is deliberately no composite "AI visibility score": the
 * providers expose no ranking signal, and `ai_visibility_observations` keeps
 * `status` (did we get an answer) separate from `outcome` (what it said) for
 * exactly that reason. `answerShare` therefore divides by `answered`, never by
 * `answered + unavailable` — a provider outage must not read as brand absence.
 */
const aiVisibilityCountsSchema = z.object({
  answered: z.number().int(),
  unavailable: z.number().int(),
  brandMentioned: z.number().int(),
  brandAbsent: z.number().int(),
  mentionTotal: z.number().int(),
  domainCited: z.number().int(),
  /** brandMentioned / answered, or null when nothing was answered. Never 0. */
  answerShare: z.number().nullable(),
});

const aiVisibilitySectionSchema = z.object({
  configs: z.array(
    z.object({
      configId: z.string(),
      brandName: z.string(),
      domain: z.string(),
      runId: z.string(),
      freshness: sectionFreshnessSchema,
      summary: aiVisibilityCountsSchema,
      previous: aiVisibilityCountsSchema
        .extend({ capturedAt: z.string() })
        .nullable(),
      providers: z.array(
        aiVisibilityCountsSchema.extend({ provider: z.string() }),
      ),
    }),
  ),
  /** Tracked configs the period has nothing to say about, and why. */
  unavailable: z.array(
    z.object({
      configId: z.string(),
      brandName: z.string(),
      reason: z.enum(["no_completed_run", "no_observations"]),
    }),
  ),
});

const geoGridMetricsSchema = z.object({
  cellsTotal: z.number().int(),
  cellsCompleted: z.number().int(),
  /** Cells where the profile actually appeared. The rest are not zeroes. */
  rankedCells: z.number().int(),
  averageRank: z.number().nullable(),
  topThreeCoverage: z.number().nullable(),
  topTenCoverage: z.number().nullable(),
  topTwentyCoverage: z.number().nullable(),
});

const trafficInsightsSectionSchema = z.object({
  range: z.object({
    startDate: dateField,
    endDate: dateField,
  }),
  sources: z.object({
    ga4: z.enum(["connected", "not_connected", "error"]),
    gsc: z.enum(["connected", "not_connected", "error"]),
    rankTracking: z.enum(["connected", "not_configured"]),
  }),
  summary: z.object({
    pageCount: z.number().int(),
    sessions: z.number().nullable(),
    clicks: z.number().nullable(),
    trackedKeywords: z.number().nullable(),
  }),
  pages: z.array(
    z.object({
      url: z.string(),
      sessions: z.number().nullable(),
      engagementRate: z.number().nullable(),
      keyEvents: z.number().nullable(),
      clicks: z.number().nullable(),
      impressions: z.number().nullable(),
      ctr: z.number().nullable(),
      averagePosition: z.number().nullable(),
      queries: z.string(),
      keywords: z.string(),
      keywordCount: z.number().nullable(),
      bestPosition: z.number().nullable(),
      coverage: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});

const onPageIdeasSectionSchema = z.object({
  freshness: sectionFreshnessSchema,
  totalIdeas: z.number().int(),
  unresolvedIdeas: z.number().int(),
  byBucket: z.array(
    z.object({
      bucket: z.string(),
      count: z.number().int(),
    }),
  ),
  topPages: z.array(
    z.object({
      url: z.string(),
      ideaCount: z.number().int(),
    }),
  ),
});

const localGeoGridSectionSchema = z.object({
  configs: z.array(
    z.object({
      configId: z.string(),
      keyword: z.string(),
      businessName: z.string(),
      device: z.enum(["desktop", "mobile"]),
      gridSize: z.number().int(),
      radiusMeters: z.number().int(),
      runId: z.string(),
      freshness: sectionFreshnessSchema,
      summary: geoGridMetricsSchema,
      previous: geoGridMetricsSchema
        .extend({ capturedAt: z.string() })
        .nullable(),
    }),
  ),
  unavailable: z.array(
    z.object({
      configId: z.string(),
      keyword: z.string(),
      reason: z.enum(["no_completed_run", "no_cells"]),
    }),
  ),
});

export const reportSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: isoDateTimeField,
  project: z.object({
    id: z.string(),
    name: z.string(),
    domain: z.string().nullable(),
  }),
  period: z.object({ start: dateField, end: dateField }),
  comparisonPeriod: z.object({ start: dateField, end: dateField }),
  sections: z.array(
    z.discriminatedUnion("key", [
      z.object({ key: z.literal("rankings"), data: rankingsSectionSchema }),
      z.object({ key: z.literal("gsc"), data: gscSectionSchema }),
      z.object({ key: z.literal("ga4"), data: ga4SectionSchema }),
      z.object({ key: z.literal("google_ads"), data: googleAdsSectionSchema }),
      z.object({ key: z.literal("audit"), data: auditSectionSchema }),
      z.object({ key: z.literal("backlinks"), data: backlinksSectionSchema }),
      z.object({
        key: z.literal("ai_visibility"),
        data: aiVisibilitySectionSchema,
      }),
      z.object({
        key: z.literal("local_geo_grid"),
        data: localGeoGridSectionSchema,
      }),
      z.object({
        key: z.literal("traffic_insights"),
        data: trafficInsightsSectionSchema,
      }),
      z.object({
        key: z.literal("on_page_ideas"),
        data: onPageIdeasSectionSchema,
      }),
    ]),
  ),
  omissions: z.array(
    z.object({
      key: reportSectionKeySchema,
      reason: z.enum(["disabled", "not_configured", "no_data"]),
    }),
  ),
  evidence: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
      direction: z.enum(["positive", "negative", "neutral"]),
    }),
  ),
});

export type ReportSectionKey = z.infer<typeof reportSectionKeySchema>;
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;
export type ReportCommentaryKind = z.infer<typeof reportCommentaryKindSchema>;
