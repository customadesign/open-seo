import { z } from "zod";

export const REPORT_SECTION_KEYS = [
  "rank",
  "audit",
  "backlinks",
  "local",
  "gsc",
  "ga4",
  "changes",
] as const;

export const reportSectionKeySchema = z.enum(REPORT_SECTION_KEYS);

const REPORT_SECTION_LABELS: Record<
  (typeof REPORT_SECTION_KEYS)[number],
  string
> = {
  rank: "Search rankings",
  audit: "Site health",
  backlinks: "Backlinks",
  local: "Local visibility",
  gsc: "Google Search Console",
  ga4: "Google Analytics",
  changes: "Changes",
};

const REPORT_SECTION_LABEL_BY_KEY = new Map<string, string>(
  Object.entries(REPORT_SECTION_LABELS),
);

export function reportSectionLabel(key: string): string {
  return REPORT_SECTION_LABEL_BY_KEY.get(key) ?? key;
}

export const reportFrequencySchema = z.enum(["manual", "weekly", "monthly"]);

const idField = z.string().min(1).max(160);
const isoDateTimeField = z.string().datetime({ offset: true });
const colorField = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color, for example #2563eb");
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
  .max(2_000)
  .refine(isHttpUrl, { message: "URL must use HTTP or HTTPS" });

export const reportBrandingSchema = z.object({
  brandName: z.string().trim().min(1).max(120).optional(),
  logoUrl: httpUrlField.optional(),
  primaryColor: colorField.optional(),
  accentColor: colorField.optional(),
});

export const resolvedReportBrandingSchema = z.object({
  brandName: z.string().min(1),
  logoUrl: httpUrlField.nullable(),
  primaryColor: colorField,
  accentColor: colorField,
});

const reportPeriodSchema = z
  .object({
    periodStart: isoDateTimeField,
    periodEnd: isoDateTimeField,
  })
  .refine((period) => period.periodStart < period.periodEnd, {
    message: "Report period end must be after its start.",
    path: ["periodEnd"],
  });

const reportTemplateSectionInputSchema = z.object({
  key: reportSectionKeySchema,
  enabled: z.boolean().default(true),
});

export const listReportsSchema = z.object({ projectId: idField });

export const createReportTemplateSchema = z.object({
  projectId: idField,
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().default(false),
  branding: reportBrandingSchema.optional(),
  sections: z
    .array(reportTemplateSectionInputSchema)
    .min(1)
    .max(REPORT_SECTION_KEYS.length)
    .refine(
      (sections) =>
        new Set(sections.map((section) => section.key)).size ===
        sections.length,
      "Report sections must be unique.",
    )
    .default(REPORT_SECTION_KEYS.map((key) => ({ key, enabled: true }))),
});

export const deleteReportTemplateSchema = z.object({
  projectId: idField,
  templateId: idField,
});

export const createReportScheduleSchema = z.object({
  projectId: idField,
  templateId: idField,
  name: z.string().trim().min(1).max(120),
  frequency: reportFrequencySchema,
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  firstRunAt: isoDateTimeField.optional(),
  recipients: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email().max(320),
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .max(100)
    .default([]),
});

export const runReportSchema = z
  .object({
    projectId: idField,
    templateId: idField,
    branding: reportBrandingSchema.optional(),
  })
  .and(reportPeriodSchema);

export const retryReportRunSchema = z.object({
  projectId: idField,
  runId: idField,
});

export const createReportShareLinkSchema = z.object({
  projectId: idField,
  runId: idField,
  expiresAt: isoDateTimeField,
});

export const reportSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: isoDateTimeField,
  project: z.object({
    id: z.string(),
    name: z.string(),
    domain: z.string().nullable(),
  }),
  period: z.object({ start: isoDateTimeField, end: isoDateTimeField }),
  branding: resolvedReportBrandingSchema,
  sections: z.array(
    z.object({
      key: reportSectionKeySchema,
      data: z.unknown(),
    }),
  ),
  omissions: z.array(
    z.object({
      key: reportSectionKeySchema,
      reason: z.enum(["not_configured", "no_data", "source_error"]),
    }),
  ),
});

export type ReportSectionKey = z.infer<typeof reportSectionKeySchema>;
export type ReportFrequency = z.infer<typeof reportFrequencySchema>;
export type ReportBranding = z.infer<typeof reportBrandingSchema>;
export type ResolvedReportBranding = z.infer<
  typeof resolvedReportBrandingSchema
>;
export type CreateReportTemplateInput = z.infer<
  typeof createReportTemplateSchema
>;
export type CreateReportScheduleInput = z.infer<
  typeof createReportScheduleSchema
>;
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;
