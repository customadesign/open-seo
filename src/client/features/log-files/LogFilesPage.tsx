import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteLogFile,
  getLogFileReport,
  listLogFiles,
  uploadLogFile,
} from "@/serverFunctions/log-files";
import { MAX_LOG_FILE_BYTES } from "@/shared/log-files";
import { LogFileReports } from "./LogFileReports";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LogFilesPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const accessQuery = useWorkspaceAccess();
  const canManage = accessQuery.data?.canUseProjectTools === true;
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [progress, setProgress] = useState<number | null>(null);

  const listKey = ["log-files", projectId];
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => listLogFiles({ data: { projectId } }),
  });
  const uploads = listQuery.data ?? [];
  const activeId =
    selectedId ?? uploads.find((row) => row.status === "completed")?.id;

  const reportQuery = useQuery({
    queryKey: ["log-file-report", projectId, activeId],
    queryFn: () =>
      getLogFileReport({ data: { projectId, uploadId: activeId } }),
    enabled: Boolean(activeId),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress(5);
      const result = await uploadLogFile({
        data: { projectId, fileName: file.name, file },
      });
      setProgress(100);
      return result;
    },
    onSuccess: async (result) => {
      setSelectedId(result.uploadId);
      await queryClient.invalidateQueries({ queryKey: listKey });
      toast.success(
        `Parsed ${result.linesParsed.toLocaleString()} lines, skipped ${result.linesSkipped.toLocaleString()}.`,
      );
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
    onSettled: () => setProgress(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (uploadId: string) =>
      deleteLogFile({ data: { projectId, uploadId } }),
    onSuccess: async (_, uploadId) => {
      if (selectedId === uploadId) setSelectedId(undefined);
      await queryClient.invalidateQueries({ queryKey: listKey });
      toast.success("Log file removed");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const report = reportQuery.data;

  return (
    <div className="h-full overflow-auto bg-base-100">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 py-8 sm:p-6 md:py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Log Files</h1>
            <p className="mt-1 max-w-2xl text-sm text-base-content/60">
              Upload an uncompressed access log to see what Googlebot, Bingbot,
              and known AI crawlers actually requested. Raw IPs are used to
              verify bots, then discarded. Files expire after 30 days.
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={uploadMutation.isPending}
                onClick={() => fileInput.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload log
              </button>
              <p className="text-xs text-base-content/50">
                Combined, Common, or W3C. Max {formatBytes(MAX_LOG_FILE_BYTES)}.
              </p>
              <input
                ref={fileInput}
                className="hidden"
                type="file"
                accept=".log,.txt,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) uploadMutation.mutate(file);
                }}
              />
            </div>
          ) : null}
        </header>

        {progress !== null ? (
          <progress
            className="progress progress-primary w-full"
            value={progress}
            max={100}
          />
        ) : null}

        {listQuery.isError ? (
          <div className="alert alert-error">
            {getStandardErrorMessage(listQuery.error)}
          </div>
        ) : null}

        <section className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3">
            <h2 className="card-title text-base">Uploads</h2>
            {uploads.length === 0 ? (
              <p className="text-sm text-base-content/60">
                No access logs uploaded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Status</th>
                      <th>Parsed</th>
                      <th>Range</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((upload) => (
                      <tr
                        key={upload.id}
                        className={
                          upload.id === activeId ? "bg-base-200" : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="link link-hover text-left"
                            onClick={() => setSelectedId(upload.id)}
                          >
                            {upload.originalFilename}
                          </button>
                          <div className="text-xs text-base-content/50">
                            {formatBytes(upload.sizeBytes)} ·{" "}
                            {upload.format ?? "—"}
                          </div>
                        </td>
                        <td>{upload.status}</td>
                        <td>
                          {upload.linesParsed.toLocaleString()} / skipped{" "}
                          {upload.linesSkipped.toLocaleString()}
                        </td>
                        <td>
                          {upload.dateFrom && upload.dateTo
                            ? `${upload.dateFrom} → ${upload.dateTo}`
                            : "—"}
                        </td>
                        <td>
                          {canManage ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => deleteMutation.mutate(upload.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {report ? (
          <LogFileReports
            summary={{
              linesParsed: report.upload.linesParsed,
              linesSkipped: report.upload.linesSkipped,
              dateFrom: report.upload.dateFrom,
              dateTo: report.upload.dateTo,
              format: report.upload.format,
              bots: report.bots,
            }}
            reports={report.reports}
          />
        ) : null}
      </div>
    </div>
  );
}
