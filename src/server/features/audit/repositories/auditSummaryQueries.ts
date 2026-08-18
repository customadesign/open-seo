import { and, count, countDistinct, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues, audits } from "@/db/schema";

/**
 * Distinct-page counts per issue type for one audit — link-level issues
 * write one row per occurrence, and consumers phrase this as "N pages".
 * Lives beside AuditRepository (same pattern as rank-tracking's
 * snapshotQueries) to keep the main repository under the file-size limit.
 */
export async function getIssueTypePageCountsForAudit(auditId: string) {
  return db
    .select({
      issueType: auditIssues.issueType,
      severity: auditIssues.severity,
      pages: countDistinct(auditIssues.pageUrl),
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, auditId))
    .groupBy(auditIssues.issueType, auditIssues.severity);
}

/**
 * Issue counts per (page, severity) for one audit — the input to the site
 * health score, which caps each page's penalty and therefore needs the split
 * by page rather than one total per severity.
 */
export async function getPageSeverityCountsForAudit(auditId: string) {
  return db
    .select({
      pageUrl: auditIssues.pageUrl,
      severity: auditIssues.severity,
      issues: count(),
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, auditId))
    .groupBy(auditIssues.pageUrl, auditIssues.severity);
}

/** Newest first. Two rows is what the site health card needs for its delta. */
export async function getRecentCompletedAudits(
  projectId: string,
  limit: number,
) {
  return db
    .select({
      id: audits.id,
      pagesCrawled: audits.pagesCrawled,
      startedAt: audits.startedAt,
      completedAt: audits.completedAt,
    })
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "completed")))
    .orderBy(desc(audits.startedAt), desc(audits.id))
    .limit(limit);
}
