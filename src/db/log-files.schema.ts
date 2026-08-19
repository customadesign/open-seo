import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { user } from "./better-auth-schema";
import {
  LOG_FILE_BOT_IDS,
  LOG_FILE_FORMATS,
  LOG_FILE_STATUSES,
} from "@/shared/log-files";

export const logFileUploads = sqliteTable(
  "log_file_uploads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    r2Key: text("r2_key").notNull(),
    format: text("format", { enum: LOG_FILE_FORMATS }),
    status: text("status", { enum: LOG_FILE_STATUSES })
      .notNull()
      .default("processing"),
    linesParsed: integer("lines_parsed").notNull().default(0),
    linesSkipped: integer("lines_skipped").notNull().default(0),
    dateFrom: text("date_from"),
    dateTo: text("date_to"),
    expiresAt: text("expires_at").notNull(),
    errorDetail: text("error_detail"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("log_file_uploads_project_id_idx").on(table.projectId),
    index("log_file_uploads_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const logFileBotSummaries = sqliteTable(
  "log_file_bot_summaries",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id")
      .notNull()
      .references(() => logFileUploads.id, { onDelete: "cascade" }),
    botId: text("bot_id", { enum: LOG_FILE_BOT_IDS }).notNull(),
    requests: integer("requests").notNull().default(0),
    verifiedRequests: integer("verified_requests").notNull().default(0),
    unverifiedRequests: integer("unverified_requests").notNull().default(0),
    uniqueIpsClaimed: integer("unique_ips_claimed").notNull().default(0),
  },
  (table) => [
    uniqueIndex("log_file_bot_summaries_upload_bot_idx").on(
      table.uploadId,
      table.botId,
    ),
  ],
);

export const logPathDaily = sqliteTable(
  "log_path_daily",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id")
      .notNull()
      .references(() => logFileUploads.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    botId: text("bot_id", { enum: LOG_FILE_BOT_IDS }).notNull(),
    day: text("day").notNull(),
    path: text("path").notNull(),
    requests: integer("requests").notNull().default(0),
    verifiedRequests: integer("verified_requests").notNull().default(0),
    bytesTotal: integer("bytes_total").notNull().default(0),
    responseTimeMsSum: integer("response_time_ms_sum").notNull().default(0),
    responseTimeSamples: integer("response_time_samples").notNull().default(0),
    status2xx: integer("status_2xx").notNull().default(0),
    status3xx: integer("status_3xx").notNull().default(0),
    status4xx: integer("status_4xx").notNull().default(0),
    status5xx: integer("status_5xx").notNull().default(0),
  },
  (table) => [
    uniqueIndex("log_path_daily_upload_bot_day_path_idx").on(
      table.uploadId,
      table.botId,
      table.day,
      table.path,
    ),
    index("log_path_daily_project_bot_day_idx").on(
      table.projectId,
      table.botId,
      table.day,
    ),
    index("log_path_daily_upload_id_idx").on(table.uploadId),
  ],
);
