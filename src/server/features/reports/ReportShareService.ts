import { AppError } from "@/server/lib/errors";
import {
  MAX_SHARE_LINK_TTL_DAYS,
  SHARE_LINK_RETENTION_DAYS,
} from "@/shared/report-delivery";
import { reportSnapshotSchema } from "@/types/schemas/reports";
import { getReportProviders } from "./defaultReportProviders";
import { resolveReportBranding } from "./reportPresentation";
import {
  createReportShareToken,
  hashReportShareToken,
  isReportShareLinkUsable,
} from "./reportShareTokens";
import { ReportDeliveryProfileRepository } from "./repositories/ReportDeliveryProfileRepository";
import { ReportDeliveryRepository } from "./repositories/ReportDeliveryRepository";
import { ReportRepository } from "./repositories/ReportRepository";

const ARTIFACT_PURGE_BATCH = 200;

function addDays(from: Date, days: number): Date {
  return new Date(from.valueOf() + days * 86_400_000);
}

async function createShareLink(input: {
  projectId: string;
  runId: string;
  expiresInDays: number;
  userId: string | null;
  now?: Date;
}) {
  const run = await ReportRepository.getRun(input.projectId, input.runId);
  if (!run || run.status !== "published" || !run.snapshotJson) {
    throw new AppError("NOT_FOUND", "Published report not found.");
  }
  const now = input.now ?? new Date();
  const days = Math.min(
    Math.max(input.expiresInDays, 1),
    MAX_SHARE_LINK_TTL_DAYS,
  );
  const { token, tokenHash } = await createReportShareToken();
  const expiresAt = addDays(now, days).toISOString();
  await ReportDeliveryRepository.createShareLink({
    id: crypto.randomUUID(),
    runId: run.id,
    tokenHash,
    expiresAt,
    createdByUserId: input.userId,
  });
  const { shareBaseUrl } = await getReportProviders();
  return {
    token,
    expiresAt,
    url: shareBaseUrl ? `${shareBaseUrl}/api/reports/share/${token}` : null,
  };
}

async function listShareLinks(input: { projectId: string; runId: string }) {
  const run = await ReportRepository.getRun(input.projectId, input.runId);
  if (!run) throw new AppError("NOT_FOUND", "Report not found.");
  const links = await ReportDeliveryRepository.listShareLinks(run.id);
  return links.map((link) => ({
    id: link.id,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    lastAccessedAt: link.lastAccessedAt,
    accessCount: link.accessCount,
    createdAt: link.createdAt,
  }));
}

async function revokeShareLink(input: {
  projectId: string;
  shareLinkId: string;
}) {
  const revoked = await ReportDeliveryRepository.revokeShareLink({
    projectId: input.projectId,
    shareLinkId: input.shareLinkId,
    nowIso: new Date().toISOString(),
  });
  if (!revoked) throw new AppError("NOT_FOUND", "Share link not found.");
  return { shareLinkId: input.shareLinkId };
}

/** Public, unauthenticated read path. Everything it returns is derived from a
 * single unexpired, unrevoked token. */
async function resolveShareLink(token: string, now: Date = new Date()) {
  const row = await ReportDeliveryRepository.getShareLinkByHash(
    await hashReportShareToken(token),
  );
  if (!row || !isReportShareLinkUsable(row.link, now)) return null;
  if (row.run.status !== "published" || !row.run.snapshotJson) return null;
  const [commentary, artifacts] = await Promise.all([
    ReportRepository.listCommentary(row.run.id),
    ReportDeliveryRepository.listArtifacts(row.run.id),
    ReportDeliveryRepository.markShareLinkAccessed(
      row.link.id,
      now.toISOString(),
    ),
  ]);
  const profile = row.run.profileId
    ? await ReportDeliveryProfileRepository.getProfileById(row.run.profileId)
    : null;
  return {
    runId: row.run.id,
    expiresAt: row.link.expiresAt,
    branding: resolveReportBranding(profile),
    snapshot: reportSnapshotSchema.parse(
      JSON.parse(row.run.snapshotJson) as unknown,
    ),
    commentary: commentary.map((item) => ({
      kind: item.kind,
      text: item.text,
    })),
    artifacts: artifacts.map((artifact) => ({
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      checksumSha256: artifact.checksumSha256,
    })),
  };
}

/**
 * Retention sweep: PDFs live 13 months, share rows are dropped 90 days after
 * they expire. Storage objects are deleted before their rows so a failure
 * mid-sweep leaves a retryable pointer rather than an orphaned object.
 */
async function purgeExpiredArtifacts(now: Date = new Date()) {
  const { bucket } = await getReportProviders();
  const expired = await ReportDeliveryRepository.listExpiredArtifacts(
    now.toISOString(),
    ARTIFACT_PURGE_BATCH,
  );
  const deletedIds: string[] = [];
  for (const artifact of expired) {
    try {
      await bucket?.delete(artifact.storageKey);
      deletedIds.push(artifact.id);
    } catch (error) {
      console.error(
        `[retention] Could not delete report artifact ${artifact.storageKey}`,
        error,
      );
    }
  }
  await ReportDeliveryRepository.deleteArtifacts(deletedIds);
  const shareLinks =
    await ReportDeliveryRepository.deleteShareLinksExpiredBefore(
      addDays(now, -SHARE_LINK_RETENTION_DAYS).toISOString(),
    );
  return { artifacts: deletedIds.length, shareLinks };
}

export const ReportShareService = {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  resolveShareLink,
  purgeExpiredArtifacts,
};
