import type { AuditScheduleSkipReason } from "@/shared/audit-schedule";

// Keyed loosely so an unknown value from an older deployment can be looked up
// without a cast; `satisfies` still forces every known reason to have a label.
const SKIP_REASON_LABELS: Record<string, string | undefined> = {
  audit_running: "another audit for this project was still running",
  plan_required: "a paid plan is required",
  start_failed:
    "the audit could not be started (check the crawl limits and URL)",
} satisfies Record<AuditScheduleSkipReason, string>;

/**
 * `last_skip_reason` is free-form text in the schema, so a row can hold a value
 * this build has no label for. Return null rather than showing a raw key.
 */
export function auditScheduleSkipReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return SKIP_REASON_LABELS[reason] ?? null;
}
