import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues, audits } from "@/db/schema";

/** The baseline for a change comparison: the previous completed audit of the
 * same start URL, so a one-off audit of a different section cannot look like a
 * site-wide regression. */
async function getPreviousCompletedAudit(input: {
  projectId: string;
  startUrl: string;
  beforeStartedAt: string;
}) {
  const rows = await db
    .select({ id: audits.id, startedAt: audits.startedAt })
    .from(audits)
    .where(
      and(
        eq(audits.projectId, input.projectId),
        eq(audits.startUrl, input.startUrl),
        eq(audits.status, "completed"),
        lt(audits.startedAt, input.beforeStartedAt),
      ),
    )
    .orderBy(desc(audits.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function listComparableIssues(auditId: string) {
  return db
    .select({
      issueType: auditIssues.issueType,
      severity: auditIssues.severity,
      pageUrl: auditIssues.pageUrl,
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, auditId));
}

export const AuditComparisonRepository = {
  getPreviousCompletedAudit,
  listComparableIssues,
};
