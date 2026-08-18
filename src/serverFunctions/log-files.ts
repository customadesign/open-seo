import { createServerFn } from "@tanstack/react-start";
import { LogFileService } from "@/server/features/log-files/services/LogFileService";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import {
  deleteLogFileSchema,
  getLogFileReportSchema,
  listLogFilesSchema,
  uploadLogFileSchema,
} from "@/types/schemas/log-files";

export const uploadLogFile = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(uploadLogFileSchema)
  .handler(({ data, context }) =>
    LogFileService.upload({
      projectId: context.projectId,
      uploadedByUserId: context.userId,
      fileName: data.fileName,
      file: data.file,
    }),
  );

export const listLogFiles = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listLogFilesSchema)
  .handler(({ context }) => LogFileService.list(context.projectId));

export const getLogFileReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getLogFileReportSchema)
  .handler(({ data, context }) =>
    LogFileService.getReport(
      context.projectId,
      data.uploadId,
      context.project.domain,
    ),
  );

export const deleteLogFile = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(deleteLogFileSchema)
  .handler(({ data, context }) =>
    LogFileService.delete(context.projectId, data.uploadId),
  );
