import { env } from "cloudflare:workers";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { LogFileRepository } from "@/server/features/log-files/repositories/LogFileRepository";
import { aggregateLogStream } from "@/server/lib/log-files/aggregate";
import { dohLookups } from "@/server/lib/log-files/dns";
import { buildLogFileReports } from "@/server/lib/log-files/reports";
import { AppError } from "@/server/lib/errors";
import { getStreamFromR2, putStreamToR2 } from "@/server/lib/r2";
import {
  LOG_FILE_BOT_LABELS,
  LOG_FILE_RETENTION_DAYS,
  MAX_LOG_FILE_BYTES,
} from "@/shared/log-files";

function safeFilename(name: string) {
  const base = name.split(/[/\\]/).pop()?.trim() || "access.log";
  return base.replace(/[^\w.-]+/g, "_").slice(0, 180);
}

function isCompressedName(name: string) {
  return /\.(gz|gzip|zip|bz2|xz|zst)$/i.test(name);
}

function retentionExpiresAt() {
  return new Date(
    Date.now() + LOG_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function logObjectKey(projectId: string, uploadId: string, fileName: string) {
  return `log-files/${projectId}/${uploadId}/${safeFilename(fileName)}`;
}

async function latestAuditPages(projectId: string) {
  const audit = await AuditRepository.getLatestAuditForProject(projectId);
  if (!audit) return [];
  const pages = await AuditRepository.getPagesForAudit(audit.id);
  return pages.map((page) => ({
    url: page.url,
    crawlDepth: page.crawlDepth,
    inSitemap: page.inSitemap,
  }));
}

export const LogFileService = {
  async upload(input: {
    projectId: string;
    uploadedByUserId: string;
    fileName: string;
    file: File;
  }) {
    if (isCompressedName(input.fileName) || isCompressedName(input.file.name)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Upload an uncompressed access log (Combined, Common, or W3C).",
      );
    }
    if (input.file.size <= 0) {
      throw new AppError("VALIDATION_ERROR", "The log file is empty.");
    }
    if (input.file.size > MAX_LOG_FILE_BYTES) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Log files must be ${MAX_LOG_FILE_BYTES} bytes or smaller.`,
      );
    }

    const uploadId = crypto.randomUUID();
    const r2Key = logObjectKey(input.projectId, uploadId, input.fileName);
    await putStreamToR2(r2Key, input.file.stream());
    await LogFileRepository.createUpload({
      id: uploadId,
      projectId: input.projectId,
      uploadedByUserId: input.uploadedByUserId,
      originalFilename: safeFilename(input.fileName),
      sizeBytes: input.file.size,
      r2Key,
      expiresAt: retentionExpiresAt(),
    });

    try {
      const stream = await getStreamFromR2(r2Key);
      const parsed = await aggregateLogStream(stream, dohLookups);
      await LogFileRepository.insertAggregates({
        uploadId,
        projectId: input.projectId,
        bots: parsed.bots,
        pathDaily: parsed.pathDaily,
      });
      await LogFileRepository.completeUpload(uploadId, input.projectId, {
        format: parsed.format,
        linesParsed: parsed.linesParsed,
        linesSkipped: parsed.linesSkipped,
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
      });
      return {
        uploadId,
        format: parsed.format,
        linesParsed: parsed.linesParsed,
        linesSkipped: parsed.linesSkipped,
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
        botsSeen: parsed.bots.map((bot) => ({
          botId: bot.botId,
          label: LOG_FILE_BOT_LABELS[bot.botId],
          requests: bot.requests,
          verifiedRequests: bot.verifiedRequests,
          unverifiedRequests: bot.unverifiedRequests,
        })),
        pathRows: parsed.pathDaily.length,
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message.slice(0, 500) : "Parse failed";
      await LogFileRepository.failUpload(uploadId, input.projectId, detail);
      throw new AppError("INTERNAL_ERROR", "Could not parse the log file.");
    }
  },

  async list(projectId: string) {
    const uploads = await LogFileRepository.listUploads(projectId);
    return uploads.map((upload) => ({
      id: upload.id,
      originalFilename: upload.originalFilename,
      sizeBytes: upload.sizeBytes,
      format: upload.format,
      status: upload.status,
      linesParsed: upload.linesParsed,
      linesSkipped: upload.linesSkipped,
      dateFrom: upload.dateFrom,
      dateTo: upload.dateTo,
      expiresAt: upload.expiresAt,
      createdAt: upload.createdAt,
      errorDetail: upload.errorDetail,
    }));
  },

  async getReport(
    projectId: string,
    uploadId: string | undefined,
    projectDomain: string | null,
  ) {
    const upload = uploadId
      ? await LogFileRepository.getUpload(uploadId, projectId)
      : await LogFileRepository.getLatestCompletedUpload(projectId);
    if (!upload) {
      throw new AppError("NOT_FOUND", "No parsed log file in this project.");
    }
    if (upload.status !== "completed") {
      return {
        upload: {
          id: upload.id,
          originalFilename: upload.originalFilename,
          format: upload.format,
          status: upload.status,
          linesParsed: upload.linesParsed,
          linesSkipped: upload.linesSkipped,
          dateFrom: upload.dateFrom,
          dateTo: upload.dateTo,
          expiresAt: upload.expiresAt,
          createdAt: upload.createdAt,
          errorDetail: upload.errorDetail,
        },
        bots: [],
        reports: buildLogFileReports({
          pathDaily: [],
          bots: [],
          auditPages: [],
          projectDomain,
        }),
      };
    }

    const [bots, pathDaily, auditPages] = await Promise.all([
      LogFileRepository.listBotSummaries(upload.id),
      LogFileRepository.listPathDaily(upload.id),
      latestAuditPages(projectId),
    ]);

    return {
      upload: {
        id: upload.id,
        originalFilename: upload.originalFilename,
        format: upload.format,
        status: upload.status,
        linesParsed: upload.linesParsed,
        linesSkipped: upload.linesSkipped,
        dateFrom: upload.dateFrom,
        dateTo: upload.dateTo,
        expiresAt: upload.expiresAt,
        createdAt: upload.createdAt,
        errorDetail: upload.errorDetail,
      },
      bots: bots.map((bot) => ({
        botId: bot.botId,
        label: LOG_FILE_BOT_LABELS[bot.botId],
        requests: bot.requests,
        verifiedRequests: bot.verifiedRequests,
        unverifiedRequests: bot.unverifiedRequests,
        uniqueIpsClaimed: bot.uniqueIpsClaimed,
      })),
      reports: buildLogFileReports({
        pathDaily,
        bots,
        auditPages,
        projectDomain,
      }),
    };
  },

  async getCrawlBudgetSummary(projectId: string, projectDomain: string | null) {
    const report = await this.getReport(projectId, undefined, projectDomain);
    return {
      uploadId: report.upload.id,
      dateFrom: report.upload.dateFrom,
      dateTo: report.upload.dateTo,
      linesParsed: report.upload.linesParsed,
      linesSkipped: report.upload.linesSkipped,
      bots: report.bots,
      crawlBudget: report.reports.crawlBudget,
    };
  },

  async delete(projectId: string, uploadId: string) {
    const upload = await LogFileRepository.getUpload(uploadId, projectId);
    if (!upload) throw new AppError("NOT_FOUND");
    await env.R2.delete(upload.r2Key);
    await LogFileRepository.deleteUpload(uploadId, projectId);
  },
};
