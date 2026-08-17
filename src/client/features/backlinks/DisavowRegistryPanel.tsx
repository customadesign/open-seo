import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Download,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { downloadFile } from "@/client/lib/download";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteDisavowEntry,
  exportDisavowEntries,
  getDisavowEntries,
  importDisavowEntries,
  saveDisavowEntry,
} from "@/serverFunctions/backlinks";
import {
  disavowEntryTypeSchema,
  disavowStatusSchema,
  type DisavowEntryType,
  type DisavowStatus,
} from "@/types/schemas/disavow";

type Entry = Awaited<ReturnType<typeof getDisavowEntries>>[number];

const STATUS_LABELS: Record<DisavowStatus, string> = {
  pending: "Pending review",
  kept: "Keep",
  removal_requested: "Removal requested",
  disavowed: "Approved for export",
  exported: "Exported",
};

export function DisavowRegistryPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["backlink-disavow", projectId] as const;
  const entriesQuery = useQuery({
    queryKey,
    queryFn: () => getDisavowEntries({ data: { projectId } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
            <ShieldAlert className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Disavow registry</span>
            <span className="block text-sm text-base-content/60">
              Review and preserve intentional domain or URL decisions. OpenSEO
              never uploads a disavow file automatically.
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-base-content/50">
          {entriesQuery.data?.length ?? 0} entries
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open ? (
        <div className="space-y-5 border-t border-base-300 p-4 sm:p-5">
          <div className="alert alert-warning text-sm">
            Google warns that an incorrect disavow list can harm search
            performance. Export only reviewed entries; uploading remains a
            manual property-owner action.
          </div>
          <RegistryActions projectId={projectId} onChanged={refresh} />
          <RegistryTable
            projectId={projectId}
            entries={entriesQuery.data ?? []}
            loading={entriesQuery.isLoading}
            onChanged={refresh}
          />
        </div>
      ) : null}
    </section>
  );
}

function RegistryActions({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => Promise<unknown>;
}) {
  const semrushInput = useRef<HTMLInputElement>(null);
  const googleInput = useRef<HTMLInputElement>(null);
  const importMutation = useMutation({
    mutationFn: (input: {
      format: "semrush_csv" | "google_txt";
      content: string;
    }) => importDisavowEntries({ data: { projectId, ...input } }),
    onSuccess: async (result) => {
      await onChanged();
      toast.success(`Imported ${result.imported} disavow entries`);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not import file")),
  });
  const exportMutation = useMutation({
    mutationFn: () => exportDisavowEntries({ data: { projectId } }),
    onSuccess: async (result) => {
      downloadFile(result.content, "openseo-disavow.txt", "text/plain");
      await onChanged();
      toast.success(`Exported ${result.entryCount} reviewed entries`);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not export file")),
  });
  const readImport = async (
    event: ChangeEvent<HTMLInputElement>,
    format: "semrush_csv" | "google_txt",
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    importMutation.mutate({ format, content: await file.text() });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="btn btn-sm btn-outline"
        disabled={importMutation.isPending}
        onClick={() => semrushInput.current?.click()}
      >
        <Upload className="size-4" /> Import SEMrush CSV
      </button>
      <input
        ref={semrushInput}
        className="hidden"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => void readImport(event, "semrush_csv")}
      />
      <button
        type="button"
        className="btn btn-sm btn-outline"
        disabled={importMutation.isPending}
        onClick={() => googleInput.current?.click()}
      >
        <Upload className="size-4" /> Import Google TXT
      </button>
      <input
        ref={googleInput}
        className="hidden"
        type="file"
        accept=".txt,text/plain"
        onChange={(event) => void readImport(event, "google_txt")}
      />
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={exportMutation.isPending}
        onClick={() => exportMutation.mutate()}
      >
        {exportMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        Export Google TXT
      </button>
    </div>
  );
}

function RegistryTable({
  projectId,
  entries,
  loading,
  onChanged,
}: {
  projectId: string;
  entries: Entry[];
  loading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  if (loading) {
    return (
      <div className="grid min-h-24 place-items-center">
        <span className="loading loading-spinner loading-sm" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <AddEntryForm projectId={projectId} onChanged={onChanged} />
      {entries.length === 0 ? (
        <p className="rounded-lg bg-base-200/50 p-4 text-sm text-base-content/60">
          No reviewed disavow decisions have been saved for this project.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Status</th>
                <th>Links</th>
                <th>Source</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <RegistryRow
                  key={entry.id}
                  projectId={projectId}
                  entry={entry}
                  onChanged={onChanged}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddEntryForm({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => Promise<unknown>;
}) {
  const [entryType, setEntryType] = useState<DisavowEntryType>("domain");
  const [value, setValue] = useState("");
  const [comments, setComments] = useState("");
  const save = useMutation({
    mutationFn: () =>
      saveDisavowEntry({
        data: {
          projectId,
          entryType,
          value,
          status: "pending",
          comments: comments.trim() || null,
          linkCount: 0,
        },
      }),
    onSuccess: async () => {
      setValue("");
      setComments("");
      await onChanged();
      toast.success("Disavow entry saved for review");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save entry")),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
      <select
        className="select select-bordered select-sm"
        value={entryType}
        onChange={(event) => {
          const parsed = disavowEntryTypeSchema.safeParse(event.target.value);
          if (parsed.success) setEntryType(parsed.data);
        }}
      >
        <option value="domain">Domain</option>
        <option value="url">URL</option>
      </select>
      <input
        className="input input-bordered input-sm min-w-0 flex-1"
        value={value}
        required
        placeholder={
          entryType === "domain" ? "spam.example" : "https://spam.example/link"
        }
        onChange={(event) => setValue(event.target.value)}
      />
      <input
        className="input input-bordered input-sm min-w-0 flex-1"
        value={comments}
        placeholder="Review note (optional)"
        onChange={(event) => setComments(event.target.value)}
      />
      <button
        type="submit"
        className="btn btn-sm btn-outline"
        disabled={save.isPending}
      >
        <Plus className="size-4" /> Add for review
      </button>
    </form>
  );
}

function RegistryRow({
  projectId,
  entry,
  onChanged,
}: {
  projectId: string;
  entry: Entry;
  onChanged: () => Promise<unknown>;
}) {
  const save = useMutation({
    mutationFn: (status: DisavowStatus) =>
      saveDisavowEntry({
        data: {
          projectId,
          id: entry.id,
          entryType: entry.entryType,
          value: entry.value,
          status,
          comments: entry.comments,
          linkCount: entry.linkCount,
        },
      }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => deleteDisavowEntry({ data: { projectId, id: entry.id } }),
    onSuccess: async () => {
      await onChanged();
      toast.success("Disavow entry removed");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  return (
    <tr>
      <td>
        <div className="max-w-md break-all font-mono text-xs">
          {entry.entryType === "domain" ? `domain:${entry.value}` : entry.value}
        </div>
        {entry.comments ? (
          <div className="mt-1 max-w-md text-xs text-base-content/50">
            {entry.comments}
          </div>
        ) : null}
      </td>
      <td>
        <select
          className="select select-bordered select-xs"
          value={entry.status}
          disabled={save.isPending}
          onChange={(event) => {
            const parsed = disavowStatusSchema.safeParse(event.target.value);
            if (parsed.success) save.mutate(parsed.data);
          }}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>{entry.linkCount.toLocaleString()}</td>
      <td className="whitespace-nowrap text-xs text-base-content/60">
        {entry.source.replace("_", " ")}
      </td>
      <td>
        <button
          type="button"
          className="btn btn-ghost btn-xs text-error"
          aria-label={`Delete ${entry.value}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${entry.value} from the registry?`)) {
              remove.mutate();
            }
          }}
        >
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  );
}
