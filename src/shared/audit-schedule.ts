/**
 * Values written to audit_schedules.last_skip_reason (free-form text in the
 * schema; this union keeps the scheduler and the UI labels in sync).
 *
 * A skip is never silent: every due tick that starts no audit records why, so
 * "the schedule is armed but nothing ran" is always explainable from the row.
 */
export type AuditScheduleSkipReason =
  /** Another audit for this project was still running — slot kept, retried. */
  | "audit_running"
  /** Hosted org without an entitled plan; the schedule advanced anyway. */
  | "plan_required"
  /** AuditService refused the start (page/capacity limit, blocked URL, ...). */
  | "start_failed";

/**
 * Cadences a schedule can hold; "manual" means the cron ignores the row. Kept
 * here (not derived from the Drizzle column) so client bundles can validate a
 * cadence without importing the database schema. AuditScheduleRepository types
 * its writes against this union, so a divergence from the column's enum is a
 * compile error.
 */
export const AUDIT_SCHEDULE_INTERVALS = [
  "daily",
  "weekly",
  "monthly",
  "manual",
] as const;

export type AuditScheduleInterval = (typeof AUDIT_SCHEDULE_INTERVALS)[number];
