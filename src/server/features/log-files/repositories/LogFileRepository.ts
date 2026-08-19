import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { logFileBotSummaries, logFileUploads, logPathDaily } from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";
import type {
  BotSummaryAggregate,
  PathDailyAggregate,
} from "@/server/lib/log-files/aggregate";
import type { LogFileFormat, LogFileStatus } from "@/shared/log-files";

export type CreateLogFileUpload = {
  id: string;
  projectId: string;
  uploadedByUserId: string;
  originalFilename: string;
  sizeBytes: number;
  r2Key: string;
  expiresAt: string;
};

async function createUpload(data: CreateLogFileUpload) {
  await db.insert(logFileUploads).values({
    ...data,
    status: "processing",
  });
}

async function completeUpload(
  uploadId: string,
  projectId: string,
  data: {
    format: LogFileFormat;
    linesParsed: number;
    linesSkipped: number;
    dateFrom: string | null;
    dateTo: string | null;
  },
) {
  await db
    .update(logFileUploads)
    .set({
      status: "completed",
      format: data.format,
      linesParsed: data.linesParsed,
      linesSkipped: data.linesSkipped,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(logFileUploads.id, uploadId),
        eq(logFileUploads.projectId, projectId),
      ),
    );
}

async function failUpload(
  uploadId: string,
  projectId: string,
  errorDetail: string,
) {
  await db
    .update(logFileUploads)
    .set({
      status: "failed",
      errorDetail,
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(logFileUploads.id, uploadId),
        eq(logFileUploads.projectId, projectId),
      ),
    );
}

async function insertAggregates(input: {
  uploadId: string;
  projectId: string;
  bots: BotSummaryAggregate[];
  pathDaily: PathDailyAggregate[];
}) {
  await executeInBatches(input.bots, (tx, bot) =>
    tx.insert(logFileBotSummaries).values({
      id: crypto.randomUUID(),
      uploadId: input.uploadId,
      botId: bot.botId,
      requests: bot.requests,
      verifiedRequests: bot.verifiedRequests,
      unverifiedRequests: bot.unverifiedRequests,
      uniqueIpsClaimed: bot.uniqueIpsClaimed,
    }),
  );
  await executeInBatches(input.pathDaily, (tx, row) =>
    tx.insert(logPathDaily).values({
      id: crypto.randomUUID(),
      uploadId: input.uploadId,
      projectId: input.projectId,
      botId: row.botId,
      day: row.day,
      path: row.path,
      requests: row.requests,
      verifiedRequests: row.verifiedRequests,
      bytesTotal: row.bytesTotal,
      responseTimeMsSum: row.responseTimeMsSum,
      responseTimeSamples: row.responseTimeSamples,
      status2xx: row.status2xx,
      status3xx: row.status3xx,
      status4xx: row.status4xx,
      status5xx: row.status5xx,
    }),
  );
}

async function listUploads(projectId: string) {
  return db
    .select()
    .from(logFileUploads)
    .where(eq(logFileUploads.projectId, projectId))
    .orderBy(desc(logFileUploads.createdAt));
}

async function getUpload(uploadId: string, projectId: string) {
  const rows = await db
    .select()
    .from(logFileUploads)
    .where(
      and(
        eq(logFileUploads.id, uploadId),
        eq(logFileUploads.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getLatestCompletedUpload(projectId: string) {
  const rows = await db
    .select()
    .from(logFileUploads)
    .where(
      and(
        eq(logFileUploads.projectId, projectId),
        eq(logFileUploads.status, "completed" satisfies LogFileStatus),
      ),
    )
    .orderBy(desc(logFileUploads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function listBotSummaries(uploadId: string) {
  return db
    .select()
    .from(logFileBotSummaries)
    .where(eq(logFileBotSummaries.uploadId, uploadId));
}

async function listPathDaily(uploadId: string) {
  return db
    .select()
    .from(logPathDaily)
    .where(eq(logPathDaily.uploadId, uploadId));
}

async function deleteUpload(uploadId: string, projectId: string) {
  await db
    .delete(logFileUploads)
    .where(
      and(
        eq(logFileUploads.id, uploadId),
        eq(logFileUploads.projectId, projectId),
      ),
    );
}

export const LogFileRepository = {
  createUpload,
  completeUpload,
  failUpload,
  insertAggregates,
  listUploads,
  getUpload,
  getLatestCompletedUpload,
  listBotSummaries,
  listPathDaily,
  deleteUpload,
};
