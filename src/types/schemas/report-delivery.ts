import { z } from "zod";
import {
  DEFAULT_SHARE_LINK_TTL_DAYS,
  MAX_REPORT_RECIPIENTS,
  MAX_SHARE_LINK_TTL_DAYS,
  REPORT_DELIVERY_FREQUENCIES,
} from "@/shared/report-delivery";
import { reportSectionKeySchema } from "./reports";
import { REPORT_SECTION_KEYS } from "@/shared/report-sections";

const idField = z.string().min(1).max(160);

// Colors are inlined into report CSS, so anything outside a hex literal would
// be a stylesheet injection point. Validate at the trust boundary instead of
// escaping downstream.
const hexColorField = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/u, "Use a 6-digit hex color, such as #2563eb.");

const httpsUrlField = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Logo URLs must be https.");

const emailField = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());

export const reportDeliveryFrequencySchema = z.enum(
  REPORT_DELIVERY_FREQUENCIES,
);

const reportBrandingSchema = z.object({
  brandName: z.string().trim().min(1).max(120).nullable().default(null),
  logoUrl: httpsUrlField.nullable().default(null),
  primaryColor: hexColorField.nullable().default(null),
  accentColor: hexColorField.nullable().default(null),
});

const sectionSelectionSchema = z
  .array(z.object({ key: reportSectionKeySchema, enabled: z.boolean() }))
  .min(1)
  .max(REPORT_SECTION_KEYS.length)
  .refine(
    (sections) =>
      new Set(sections.map((section) => section.key)).size === sections.length,
    "Report sections must be unique.",
  );

const recipientsSchema = z
  .array(
    z.object({
      email: emailField,
      name: z.string().trim().min(1).max(120).nullable().default(null),
    }),
  )
  .max(MAX_REPORT_RECIPIENTS)
  .refine(
    (recipients) =>
      new Set(recipients.map((recipient) => recipient.email)).size ===
      recipients.length,
    "Recipient emails must be unique.",
  );

const profileFields = {
  name: z.string().trim().min(1).max(120),
  frequency: reportDeliveryFrequencySchema,
  timeZone: z.string().trim().min(1).max(100),
  runDay: z.number().int().min(1).max(28).nullable().default(null),
  runWeekday: z.number().int().min(0).max(6).nullable().default(null),
  runHour: z.number().int().min(0).max(23).default(9),
  isEnabled: z.boolean().default(false),
  branding: reportBrandingSchema.default({
    brandName: null,
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  }),
  sections: sectionSelectionSchema,
  recipients: recipientsSchema,
  attachPdf: z.boolean().default(true),
  includeShareLink: z.boolean().default(true),
  shareLinkTtlDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_SHARE_LINK_TTL_DAYS)
    .default(DEFAULT_SHARE_LINK_TTL_DAYS),
};

/** Monthly needs a day of month and weekly a day of week; daily needs neither.
 * Enforcing it here keeps the scheduler free of "which field is set" branches.
 * An enabled profile also needs somewhere to send: without recipients the cron
 * would claim the schedule, build a PDF and mail nobody, which reads as a
 * silent delivery failure rather than the misconfiguration it is. */
function validateProfile(
  data: {
    frequency: ReportDeliveryFrequency;
    runDay: number | null;
    runWeekday: number | null;
    isEnabled: boolean;
    recipients: Array<{ email: string }>;
  },
  ctx: z.RefinementCtx,
) {
  if (data.frequency === "monthly" && data.runDay === null) {
    ctx.addIssue({
      code: "custom",
      path: ["runDay"],
      message: "Monthly schedules need a day of the month.",
    });
  }
  if (data.frequency === "weekly" && data.runWeekday === null) {
    ctx.addIssue({
      code: "custom",
      path: ["runWeekday"],
      message: "Weekly schedules need a day of the week.",
    });
  }
  if (data.isEnabled && data.recipients.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["recipients"],
      message: "Add at least one recipient before sending on a schedule.",
    });
  }
}

export const listReportDeliveryProfilesSchema = z.object({
  projectId: idField,
});

export const createReportDeliveryProfileSchema = z
  .object({ projectId: idField, ...profileFields })
  .superRefine(validateProfile);

export const updateReportDeliveryProfileSchema = z
  .object({ projectId: idField, profileId: idField, ...profileFields })
  .superRefine(validateProfile);

export const deleteReportDeliveryProfileSchema = z.object({
  projectId: idField,
  profileId: idField,
});

export const createReportShareLinkSchema = z.object({
  projectId: idField,
  runId: idField,
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_SHARE_LINK_TTL_DAYS)
    .default(DEFAULT_SHARE_LINK_TTL_DAYS),
});

export const revokeReportShareLinkSchema = z.object({
  projectId: idField,
  shareLinkId: idField,
});

export const listReportDeliveriesSchema = z.object({
  projectId: idField,
  runId: idField,
});

export const retryReportDeliveriesSchema = z.object({
  projectId: idField,
  runId: idField,
});

export const sendTestReportDeliverySchema = z.object({
  projectId: idField,
  runId: idField,
  profileId: idField.nullable().default(null),
  email: emailField,
});

export type ReportDeliveryFrequency = z.infer<
  typeof reportDeliveryFrequencySchema
>;
export type CreateReportDeliveryProfileInput = z.infer<
  typeof createReportDeliveryProfileSchema
>;
export type UpdateReportDeliveryProfileInput = z.infer<
  typeof updateReportDeliveryProfileSchema
>;
