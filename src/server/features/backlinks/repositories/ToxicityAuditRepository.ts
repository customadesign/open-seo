import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { backlinkToxicityAudits, backlinkToxicityDomains } from "@/db/schema";

type AuditInsert = InferInsertModel<typeof backlinkToxicityAudits>;
type DomainInsert = InferInsertModel<typeof backlinkToxicityDomains>;

const AUDITS_TO_KEEP = 3;

async function insertAudit(values: AuditInsert) {
  const [row] = await db
    .insert(backlinkToxicityAudits)
    .values(values)
    .returning();
  return row ?? null;
}

async function insertDomains(rows: DomainInsert[]) {
  await executeInBatches(rows, (tx, row) =>
    tx.insert(backlinkToxicityDomains).values(row),
  );
}

async function getLatest(projectId: string) {
  const [audit] = await db
    .select()
    .from(backlinkToxicityAudits)
    .where(eq(backlinkToxicityAudits.projectId, projectId))
    .orderBy(desc(backlinkToxicityAudits.createdAt))
    .limit(1);
  if (!audit) return null;
  const domains = await listDomains(audit.id);
  return { audit, domains };
}

async function getPrevious(projectId: string, currentCreatedAt: string) {
  const [audit] = await db
    .select()
    .from(backlinkToxicityAudits)
    .where(
      and(
        eq(backlinkToxicityAudits.projectId, projectId),
        lt(backlinkToxicityAudits.createdAt, currentCreatedAt),
      ),
    )
    .orderBy(desc(backlinkToxicityAudits.createdAt))
    .limit(1);
  if (!audit) return null;
  const domains = await listDomains(audit.id);
  return { audit, domains };
}

async function listDomains(auditId: string) {
  return db
    .select()
    .from(backlinkToxicityDomains)
    .where(eq(backlinkToxicityDomains.auditId, auditId));
}

async function pruneOlderThan(projectId: string) {
  const recent = await db
    .select({ id: backlinkToxicityAudits.id })
    .from(backlinkToxicityAudits)
    .where(eq(backlinkToxicityAudits.projectId, projectId))
    .orderBy(desc(backlinkToxicityAudits.createdAt))
    .limit(AUDITS_TO_KEEP);
  const keepIds = recent.map((row) => row.id);
  if (keepIds.length === 0) return;
  await db
    .delete(backlinkToxicityAudits)
    .where(
      and(
        eq(backlinkToxicityAudits.projectId, projectId),
        notInArray(backlinkToxicityAudits.id, keepIds),
      ),
    );
}

async function listLatestDomainsByProject(projectId: string) {
  const latest = await getLatest(projectId);
  return latest?.domains ?? [];
}

export const ToxicityAuditRepository = {
  insertAudit,
  insertDomains,
  getLatest,
  getPrevious,
  listDomains,
  listLatestDomainsByProject,
  pruneOlderThan,
} as const;

export type ToxicityAuditRow = NonNullable<
  Awaited<ReturnType<typeof insertAudit>>
>;
export type ToxicityDomainRow = Awaited<ReturnType<typeof listDomains>>[number];
