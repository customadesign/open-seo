export const REPORT_DELIVERY_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
] as const;

export const REPORT_DELIVERY_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;

export const REPORT_ARTIFACT_KINDS = ["pdf"] as const;

/** Resend accepts 25 MB per request; the renderer output is capped to match so
 * an oversized PDF fails before it reaches storage or an attachment. */
export const MAX_REPORT_PDF_BYTES = 25 * 1024 * 1024;

export const MAX_REPORT_RECIPIENTS = 25;

/** Delivery attempts per recipient before the row is parked as failed. */
export const MAX_REPORT_DELIVERY_ATTEMPTS = 3;

export const MAX_SHARE_LINK_TTL_DAYS = 90;
export const DEFAULT_SHARE_LINK_TTL_DAYS = 30;

/** Share rows are purged 90 days after they expire; PDFs live 13 months so a
 * year-over-year comparison still has its source document. */
export const SHARE_LINK_RETENTION_DAYS = 90;
export const REPORT_PDF_RETENTION_MONTHS = 13;
