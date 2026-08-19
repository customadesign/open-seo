import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import { AuditRepository } from "../repositories/AuditRepository";
import { AuditComparisonRepository } from "../repositories/AuditComparisonRepository";
import { compareAuditIssues } from "./auditComparison";

function sampleTypes(issues: Array<{ issueType: string }>): string {
  const types = [...new Set(issues.map((issue) => issue.issueType))].slice(
    0,
    3,
  );
  return types.join(", ");
}

/**
 * Turns "this audit vs the previous one" into change-feed alerts. Called from
 * the audit workflow's finalize step; a detector failure never fails the audit.
 */
async function recordAuditCompleted(input: {
  projectId: string;
  auditId: string;
  startUrl: string;
  startedAt: string;
  completedAt?: string;
}) {
  const previous = await AuditComparisonRepository.getPreviousCompletedAudit({
    projectId: input.projectId,
    startUrl: input.startUrl,
    beforeStartedAt: input.startedAt,
  });
  if (!previous) return;
  const [current, baseline] = await Promise.all([
    AuditComparisonRepository.listComparableIssues(input.auditId),
    AuditComparisonRepository.listComparableIssues(previous.id),
  ]);
  const delta = compareAuditIssues(current, baseline);
  const occurredAt = input.completedAt ?? new Date().toISOString();

  if (delta.bySeverity.critical.new > 0 || delta.bySeverity.warning.new > 0) {
    const critical = delta.bySeverity.critical.new;
    await ChangeEventService.recordSafely({
      projectId: input.projectId,
      source: "audit",
      eventType: "audit.new_issues",
      severity: critical > 0 ? "critical" : "warning",
      title: `${delta.newIssues.length} new site issue${delta.newIssues.length === 1 ? "" : "s"}`,
      summary: `Since the previous crawl: ${critical} new critical and ${delta.bySeverity.warning.new} new warning issues (${sampleTypes(delta.newIssues)}).`,
      entityType: "audit",
      entityId: input.auditId,
      sourceRunId: input.auditId,
      dedupeKey: `audit:${input.auditId}:new_issues`,
      metricKey: "audit.issue_count",
      previousNumericValue: delta.previousCount,
      currentNumericValue: delta.currentCount,
      occurredAt,
    });
  }

  const resolved = delta.resolvedIssues.length;
  if (resolved > 0) {
    await ChangeEventService.recordSafely({
      projectId: input.projectId,
      source: "audit",
      eventType: "audit.resolved_issues",
      severity: "opportunity",
      title: `${resolved} site issue${resolved === 1 ? "" : "s"} resolved`,
      summary: `Fixed since the previous crawl: ${sampleTypes(delta.resolvedIssues)}.`,
      entityType: "audit",
      entityId: input.auditId,
      sourceRunId: input.auditId,
      dedupeKey: `audit:${input.auditId}:resolved_issues`,
      metricKey: "audit.issue_count",
      previousNumericValue: delta.previousCount,
      currentNumericValue: delta.currentCount,
      occurredAt,
    });
  }
}

/**
 * Workflow entry point. Change alerts are derived state, so a detector problem
 * must never turn a finished audit into a failed one.
 */
async function recordForCompletedAudit(input: {
  auditId: string;
  projectId: string;
}) {
  try {
    const audit = await AuditRepository.getAuditForProject(
      input.auditId,
      input.projectId,
    );
    if (!audit) return;
    await recordAuditCompleted({
      projectId: input.projectId,
      auditId: input.auditId,
      startUrl: audit.startUrl,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt ?? undefined,
    });
  } catch (error) {
    console.error(
      `Audit ${input.auditId}: change events were not recorded`,
      error,
    );
  }
}

export const AuditChangeEventService = {
  recordAuditCompleted,
  recordForCompletedAudit,
};
