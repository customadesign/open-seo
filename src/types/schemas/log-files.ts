import { z } from "zod";

export const listLogFilesSchema = z.object({
  projectId: z.string().min(1),
});

export const getLogFileReportSchema = z.object({
  projectId: z.string().min(1),
  uploadId: z.string().min(1).optional(),
});

export const deleteLogFileSchema = z.object({
  projectId: z.string().min(1),
  uploadId: z.string().min(1),
});

export const uploadLogFileSchema = z.object({
  projectId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  file: z.file(),
});
