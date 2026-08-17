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

/** Resend rejects any request above 25 MB. */
export const MAX_EMAIL_REQUEST_BYTES = 25 * 1024 * 1024;

/**
 * An attachment reaches Resend base64-encoded (4 bytes for every 3) inside a
 * JSON body that also carries the HTML and text parts, so the raw PDF has to
 * stay well under the request limit rather than match it: 15 MB encodes to
 * ~20 MB and leaves ~5 MB of headroom for the rest of the message. The renderer
 * enforces the same cap, so an oversized PDF fails before it reaches storage.
 */
export const MAX_REPORT_PDF_BYTES = 15 * 1024 * 1024;

export const MAX_REPORT_RECIPIENTS = 25;

/** Delivery attempts per recipient before the row is parked as failed. */
export const MAX_REPORT_DELIVERY_ATTEMPTS = 3;

export const MAX_SHARE_LINK_TTL_DAYS = 90;
export const DEFAULT_SHARE_LINK_TTL_DAYS = 30;

/** Share rows are purged 90 days after they expire; PDFs live 13 months so a
 * year-over-year comparison still has its source document. */
export const SHARE_LINK_RETENTION_DAYS = 90;
export const REPORT_PDF_RETENTION_MONTHS = 13;
