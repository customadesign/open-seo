import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { domainOverviewSnapshots } from "@/db/schema";

type DomainOverviewSnapshot = typeof domainOverviewSnapshots.$inferSelect;

/** Newest first. Two rows is what the dashboard needs: latest and its delta. */
async function getRecentForProject(
  projectId: string,
  limit: number,
): Promise<DomainOverviewSnapshot[]> {
  return (
    db
      .select()
      .from(domainOverviewSnapshots)
      .where(eq(domainOverviewSnapshots.projectId, projectId))
      // id, not capturedAt: autoincrement is monotonic and immune to the
      // sqlite-vs-pg timestamp text-format difference.
      .orderBy(desc(domainOverviewSnapshots.id))
      .limit(limit)
  );
}

async function insert(
  values: typeof domainOverviewSnapshots.$inferInsert,
): Promise<void> {
  await db.insert(domainOverviewSnapshots).values(values);
}

export const DomainOverviewSnapshotRepository = {
  getRecentForProject,
  insert,
};
