import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { audits } from "@/db/schema";

/**
 * Is an audit already in flight for this project?
 *
 * `running` covers the queued window too: startAudit inserts the row before it
 * creates the Workflow instance, so a not-yet-started audit is already visible
 * here. The scheduled runner uses this to avoid stacking a second crawl on the
 * same site; the stale-audit watchdog is what stops a dead row from blocking
 * the schedule forever.
 *
 * Lives beside AuditRepository (same pattern as auditSummaryQueries) to keep
 * the main repository under the file-size limit.
 */
export async function hasActiveAuditForProject(
  projectId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "running")))
    .limit(1);
  return rows.length > 0;
}
