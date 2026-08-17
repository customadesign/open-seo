import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  reportArtifacts,
  reportDeliveries,
  reportRuns,
  reportShareLinks,
} from "@/db/schema";
import { runBatch } from "@/db/runBatch";

async function upsertArtifact(input: {
  runId: string;
  kind: "pdf";
  storageKey: string;
  mimeType: string;
  sizeBytes: number | null;
  checksumSha256: string | null;
  expiresAt: string;
}) {
  await db
    .insert(reportArtifacts)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: [reportArtifacts.runId, reportArtifacts.kind],
      set: {
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        expiresAt: input.expiresAt,
      },
    });
}

async function listArtifacts(runId: string) {
  return db
    .select()
    .from(reportArtifacts)
    .where(eq(reportArtifacts.runId, runId));
}

async function listExpiredArtifacts(nowIso: string, limit: number) {
  return db
    .select()
    .from(reportArtifacts)
    .where(lte(reportArtifacts.expiresAt, nowIso))
    .orderBy(asc(reportArtifacts.expiresAt))
    .limit(limit);
}

async function deleteArtifacts(ids: string[]) {
  if (ids.length === 0) return;
  await db.delete(reportArtifacts).where(inArray(reportArtifacts.id, ids));
}

async function createShareLink(input: {
  id: string;
  runId: string;
  tokenHash: string;
  expiresAt: string;
  createdByUserId: string | null;
}) {
  await db.insert(reportShareLinks).values(input);
}

async function listShareLinks(runId: string) {
  return db
    .select()
    .from(reportShareLinks)
    .where(eq(reportShareLinks.runId, runId))
    .orderBy(desc(reportShareLinks.createdAt));
}

async function getShareLinkByHash(tokenHash: string) {
  const rows = await db
    .select({ link: reportShareLinks, run: reportRuns })
    .from(reportShareLinks)
    .innerJoin(reportRuns, eq(reportShareLinks.runId, reportRuns.id))
    .where(eq(reportShareLinks.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

async function markShareLinkAccessed(id: string, nowIso: string) {
  await db
    .update(reportShareLinks)
    .set({
      lastAccessedAt: nowIso,
      accessCount: sql`${reportShareLinks.accessCount} + 1`,
    })
    .where(eq(reportShareLinks.id, id));
}

async function revokeShareLink(input: {
  projectId: string;
  shareLinkId: string;
  nowIso: string;
}) {
  const runIds = db
    .select({ id: reportRuns.id })
    .from(reportRuns)
    .where(eq(reportRuns.projectId, input.projectId));
  const rows = await db
    .update(reportShareLinks)
    .set({ revokedAt: input.nowIso })
    .where(
      and(
        eq(reportShareLinks.id, input.shareLinkId),
        inArray(reportShareLinks.runId, runIds),
        isNull(reportShareLinks.revokedAt),
      ),
    )
    .returning({ id: reportShareLinks.id });
  return Boolean(rows[0]);
}

/**
 * Revokes every still-usable link on a run. Only a token hash is stored, so a
 * re-delivery has to mint a new token; revoking the previous ones first keeps a
 * run to a single live unauthenticated URL instead of one per attempt.
 */
async function revokeShareLinksForRun(runId: string, nowIso: string) {
  const rows = await db
    .update(reportShareLinks)
    .set({ revokedAt: nowIso })
    .where(
      and(
        eq(reportShareLinks.runId, runId),
        isNull(reportShareLinks.revokedAt),
        gt(reportShareLinks.expiresAt, nowIso),
      ),
    )
    .returning({ id: reportShareLinks.id });
  return rows.length;
}

async function deleteShareLinksExpiredBefore(cutoffIso: string) {
  const rows = await db
    .delete(reportShareLinks)
    .where(lte(reportShareLinks.expiresAt, cutoffIso))
    .returning({ id: reportShareLinks.id });
  return rows.length;
}

async function insertDeliveries(
  rows: Array<{
    id: string;
    runId: string;
    profileId: string | null;
    recipientId: string | null;
    email: string;
    name: string | null;
    idempotencyKey: string;
    isTest: boolean;
    status?: "pending" | "sent" | "failed" | "skipped";
    errorMessage?: string | null;
  }>,
) {
  if (rows.length === 0) return;
  await runBatch((tx) =>
    rows.map((row) =>
      tx.insert(reportDeliveries).values(row).onConflictDoNothing(),
    ),
  );
}

async function listDeliveries(runId: string) {
  return db
    .select()
    .from(reportDeliveries)
    .where(eq(reportDeliveries.runId, runId))
    .orderBy(asc(reportDeliveries.email));
}

async function listSendableDeliveries(runId: string, maxAttempts: number) {
  return db
    .select()
    .from(reportDeliveries)
    .where(
      and(
        eq(reportDeliveries.runId, runId),
        inArray(reportDeliveries.status, ["pending", "failed"]),
        lte(reportDeliveries.attempts, maxAttempts - 1),
      ),
    )
    .orderBy(asc(reportDeliveries.email));
}

async function recordDeliveryResult(input: {
  deliveryId: string;
  status: "sent" | "failed" | "skipped";
  attempts: number;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
}) {
  await db
    .update(reportDeliveries)
    .set({
      status: input.status,
      attempts: input.attempts,
      providerMessageId: input.providerMessageId ?? null,
      errorMessage: input.errorMessage?.slice(0, 1_000) ?? null,
      sentAt: input.sentAt ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reportDeliveries.id, input.deliveryId));
}

/**
 * Operator-triggered reset of the failed recipients on a run. Attempts go back
 * to zero as well: a row that already burned its whole budget would otherwise
 * be parked as `pending` forever, since listSendableDeliveries skips it.
 */
async function resetFailedDeliveries(runId: string) {
  const rows = await db
    .update(reportDeliveries)
    .set({
      status: "pending",
      attempts: 0,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(reportDeliveries.runId, runId),
        eq(reportDeliveries.status, "failed"),
      ),
    )
    .returning({ id: reportDeliveries.id });
  return rows.length;
}

export const ReportDeliveryRepository = {
  upsertArtifact,
  listArtifacts,
  listExpiredArtifacts,
  deleteArtifacts,
  createShareLink,
  listShareLinks,
  getShareLinkByHash,
  markShareLinkAccessed,
  revokeShareLink,
  revokeShareLinksForRun,
  deleteShareLinksExpiredBefore,
  insertDeliveries,
  listDeliveries,
  listSendableDeliveries,
  recordDeliveryResult,
  resetFailedDeliveries,
};
