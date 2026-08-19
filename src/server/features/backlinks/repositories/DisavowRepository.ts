import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { backlinkDisavowEntries } from "@/db/schema";

type DisavowInsert = InferInsertModel<typeof backlinkDisavowEntries>;

async function list(projectId: string) {
  return db
    .select()
    .from(backlinkDisavowEntries)
    .where(eq(backlinkDisavowEntries.projectId, projectId))
    .orderBy(
      asc(backlinkDisavowEntries.entryType),
      asc(backlinkDisavowEntries.value),
    );
}

async function saveManual(
  input: Omit<DisavowInsert, "id" | "source" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
) {
  const now = new Date().toISOString();
  if (input.id) {
    const [entry] = await db
      .update(backlinkDisavowEntries)
      .set({
        entryType: input.entryType,
        value: input.value,
        status: input.status,
        comments: input.comments,
        linkCount: input.linkCount,
        source: "manual",
        exportedAt: input.status === "exported" ? now : input.exportedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(backlinkDisavowEntries.id, input.id),
          eq(backlinkDisavowEntries.projectId, input.projectId),
        ),
      )
      .returning();
    return entry ?? null;
  }

  const [entry] = await db
    .insert(backlinkDisavowEntries)
    .values({
      ...input,
      id: crypto.randomUUID(),
      source: "manual",
      exportedAt: input.status === "exported" ? now : input.exportedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        backlinkDisavowEntries.projectId,
        backlinkDisavowEntries.entryType,
        backlinkDisavowEntries.value,
      ],
      set: {
        status: input.status,
        comments: input.comments,
        linkCount: input.linkCount,
        source: "manual",
        exportedAt: input.status === "exported" ? now : input.exportedAt,
        updatedAt: now,
      },
    })
    .returning();
  return entry ?? null;
}

async function importMany(rows: DisavowInsert[]) {
  const now = new Date().toISOString();
  await executeInBatches(rows, (tx, row) =>
    tx
      .insert(backlinkDisavowEntries)
      .values(row)
      .onConflictDoUpdate({
        target: [
          backlinkDisavowEntries.projectId,
          backlinkDisavowEntries.entryType,
          backlinkDisavowEntries.value,
        ],
        set: {
          status: sql`CASE WHEN ${backlinkDisavowEntries.status} IN ('kept', 'disavowed') THEN ${backlinkDisavowEntries.status} ELSE excluded.status END`,
          comments: sql`COALESCE(excluded.comments, ${backlinkDisavowEntries.comments})`,
          source: sql`CASE WHEN ${backlinkDisavowEntries.source} = 'manual' THEN ${backlinkDisavowEntries.source} ELSE excluded.source END`,
          linkCount: sql`CASE WHEN excluded.link_count > ${backlinkDisavowEntries.linkCount} THEN excluded.link_count ELSE ${backlinkDisavowEntries.linkCount} END`,
          exportedAt: sql`COALESCE(excluded.exported_at, ${backlinkDisavowEntries.exportedAt})`,
          updatedAt: now,
        },
      }),
  );
}

async function remove(projectId: string, id: string) {
  const rows = await db
    .delete(backlinkDisavowEntries)
    .where(
      and(
        eq(backlinkDisavowEntries.id, id),
        eq(backlinkDisavowEntries.projectId, projectId),
      ),
    )
    .returning({ id: backlinkDisavowEntries.id });
  return rows.length > 0;
}

async function getByValue(
  projectId: string,
  entryType: DisavowInsert["entryType"],
  value: string,
) {
  const [entry] = await db
    .select()
    .from(backlinkDisavowEntries)
    .where(
      and(
        eq(backlinkDisavowEntries.projectId, projectId),
        eq(backlinkDisavowEntries.entryType, entryType),
        eq(backlinkDisavowEntries.value, value),
      ),
    )
    .limit(1);
  return entry ?? null;
}

async function listExportable(projectId: string) {
  return db
    .select()
    .from(backlinkDisavowEntries)
    .where(
      and(
        eq(backlinkDisavowEntries.projectId, projectId),
        inArray(backlinkDisavowEntries.status, ["disavowed", "exported"]),
      ),
    )
    .orderBy(
      asc(backlinkDisavowEntries.entryType),
      asc(backlinkDisavowEntries.value),
    );
}

async function markExported(
  projectId: string,
  ids: string[],
  exportedAt: string,
) {
  if (ids.length === 0) return;
  await db
    .update(backlinkDisavowEntries)
    .set({ status: "exported", exportedAt, updatedAt: exportedAt })
    .where(
      and(
        eq(backlinkDisavowEntries.projectId, projectId),
        inArray(backlinkDisavowEntries.id, ids),
      ),
    );
}

export const DisavowRepository = {
  list,
  getByValue,
  saveManual,
  importMany,
  remove,
  listExportable,
  markExported,
} as const;
