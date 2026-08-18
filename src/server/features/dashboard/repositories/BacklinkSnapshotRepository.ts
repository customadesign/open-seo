import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { backlinkSnapshots } from "@/db/schema";

type BacklinkSnapshot = typeof backlinkSnapshots.$inferSelect;

/** Newest first. Two rows is what the dashboard needs: latest and its delta. */
async function getRecentForProject(
  projectId: string,
  limit: number,
): Promise<BacklinkSnapshot[]> {
  return (
    db
      .select()
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.projectId, projectId))
      // id, not capturedAt: autoincrement is monotonic and immune to the
      // sqlite-vs-pg timestamp text-format difference.
      .orderBy(desc(backlinkSnapshots.id))
      .limit(limit)
  );
}

async function getLatestForProject(
  projectId: string,
): Promise<BacklinkSnapshot | null> {
  const rows = await getRecentForProject(projectId, 1);
  return rows[0] ?? null;
}

async function insert(
  values: typeof backlinkSnapshots.$inferInsert,
): Promise<BacklinkSnapshot> {
  const [row] = await db.insert(backlinkSnapshots).values(values).returning();
  if (!row) {
    throw new Error("Failed to insert backlink_snapshot");
  }
  return row;
}

export const BacklinkSnapshotRepository = {
  getRecentForProject,
  getLatestForProject,
  insert,
};
