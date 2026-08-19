import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Loader2,
  ShieldBan,
  ShieldCheck,
  ShieldMinus,
} from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getBacklinkToxicityAudit,
  moveToxicityDomainToDisavow,
  removeToxicityDomainFromDisavow,
  runBacklinkToxicityAudit,
  whitelistToxicityDomain,
} from "@/serverFunctions/backlinks";
import {
  TOXIC_MARKER_LABELS,
  type ToxicityClassification,
} from "@/shared/backlink-toxicity";

type Audit = NonNullable<Awaited<ReturnType<typeof getBacklinkToxicityAudit>>>;
type DomainRow = Audit["domains"][number];

const CLASS_LABELS: Record<ToxicityClassification, string> = {
  toxic: "Toxic",
  potentially_toxic: "Potentially toxic",
  non_toxic: "Non-toxic",
};

export function ToxicityAuditPanel({
  projectId,
  target,
  scope,
}: {
  projectId: string;
  target: string;
  scope: "domain" | "page";
}) {
  const [open, setOpen] = useState(true);
  const queryClient = useQueryClient();
  const queryKey = ["backlink-toxicity-audit", projectId] as const;
  const auditQuery = useQuery({
    queryKey,
    queryFn: () => getBacklinkToxicityAudit({ data: { projectId } }),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({
        queryKey: ["backlink-disavow", projectId],
      }),
    ]);
  };

  const run = useMutation({
    mutationFn: () =>
      runBacklinkToxicityAudit({
        data: { projectId, target, scope },
      }),
    onSuccess: async () => {
      await refresh();
      toast.success("Toxicity audit updated");
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not run toxicity audit"),
      ),
  });

  const audit = auditQuery.data ?? null;

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-error/10 text-error">
            <ShieldBan className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Toxicity audit</span>
            <span className="block text-sm text-base-content/60">
              Score referring domains, whitelist keepers, and queue a disavow
              list. OpenSEO never submits the file to Google.
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-base-content/50">
          {audit
            ? `${audit.toxicPercent}% toxic · ${audit.profileVerdict}`
            : "Not run"}
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-base-300 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-base-content/70">
              {target
                ? `Audit ${target} using stored backlink signals. Re-runs keep every whitelist.`
                : "Search a site first, then run the audit."}
            </p>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!target || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {audit ? "Re-run audit" : "Run audit"}
            </button>
          </div>
          {auditQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-base-content/60">
              <Loader2 className="size-4 animate-spin" /> Loading last audit
            </div>
          ) : audit ? (
            <AuditBody
              projectId={projectId}
              audit={audit}
              onChanged={refresh}
            />
          ) : (
            <p className="text-sm text-base-content/60">
              No audit saved for this project yet.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function AuditBody({
  projectId,
  audit,
  onChanged,
}: {
  projectId: string;
  audit: Audit;
  onChanged: () => Promise<unknown>;
}) {
  const [filter, setFilter] = useState<
    "candidates" | "all" | ToxicityClassification
  >("candidates");
  const rows = useMemo(() => {
    if (filter === "all") return audit.domains;
    if (filter === "candidates") {
      return audit.domains.filter((row) => row.isDisavowCandidate);
    }
    return audit.domains.filter((row) => row.classification === filter);
  }, [audit.domains, filter]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Profile"
          value={`${audit.profileVerdict} · ${audit.profileScore}`}
        />
        <Stat
          label="Toxic domains"
          value={`${audit.toxicCount} (${audit.toxicPercent}%)`}
        />
        <Stat
          label="Potentially toxic"
          value={String(audit.potentiallyToxicCount)}
        />
        <Stat
          label="Since last audit"
          value={`+${audit.newDomainCount} / −${audit.lostDomainCount} domains`}
        />
      </div>
      <p className="text-xs text-base-content/60">
        New backlinks {audit.newBacklinkCount.toLocaleString()} · lost{" "}
        {audit.lostBacklinkCount.toLocaleString()} · broken{" "}
        {audit.brokenBacklinkCount.toLocaleString()}
        {audit.truncated ? " · sample was capped" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["candidates", "Disavow candidates"],
            ["all", "All domains"],
            ["toxic", "Toxic"],
            ["potentially_toxic", "Potentially toxic"],
            ["non_toxic", "Non-toxic"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`btn btn-xs ${filter === value ? "btn-neutral" : "btn-ghost"}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Score</th>
              <th>Class</th>
              <th>Markers</th>
              <th>Delta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-base-content/60">
                  Nothing in this view.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <DomainRow
                  key={row.domain}
                  projectId={projectId}
                  row={row}
                  onChanged={onChanged}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-base-300 p-3">
      <div className="text-xs text-base-content/50">{label}</div>
      <div className="font-medium capitalize">{value}</div>
    </div>
  );
}

function DomainRow({
  projectId,
  row,
  onChanged,
}: {
  projectId: string;
  row: DomainRow;
  onChanged: () => Promise<unknown>;
}) {
  const whitelist = useMutation({
    mutationFn: () =>
      whitelistToxicityDomain({ data: { projectId, domain: row.domain } }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const move = useMutation({
    mutationFn: () =>
      moveToxicityDomainToDisavow({
        data: { projectId, domain: row.domain },
      }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () =>
      removeToxicityDomainFromDisavow({
        data: { projectId, domain: row.domain },
      }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const busy = whitelist.isPending || move.isPending || remove.isPending;
  const delta = row.isLost
    ? "Lost"
    : row.isNew
      ? "New"
      : row.isBroken
        ? "Broken"
        : "—";

  return (
    <tr>
      <td>
        <div className="max-w-xs break-all font-mono text-xs">{row.domain}</div>
        <div className="text-xs text-base-content/50">
          {row.backlinkCount.toLocaleString()} links
          {row.isWhitelisted ? " · whitelisted" : ""}
          {row.status === "disavowed" || row.status === "exported"
            ? " · queued for export"
            : ""}
        </div>
      </td>
      <td>
        {row.score}
        <span className="block text-xs text-base-content/50">
          {row.verdict}
        </span>
      </td>
      <td>{CLASS_LABELS[row.classification]}</td>
      <td className="max-w-sm text-xs">
        {row.markers.length === 0
          ? "—"
          : row.markers
              .map(
                (marker) =>
                  `${TOXIC_MARKER_LABELS[marker.code]} (${marker.detail})`,
              )
              .join("; ")}
      </td>
      <td className="whitespace-nowrap text-xs">{delta}</td>
      <td className="whitespace-nowrap">
        {row.isWhitelisted ? null : (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => whitelist.mutate()}
          >
            <ShieldCheck className="size-3.5" /> Keep
          </button>
        )}
        {row.isDisavowCandidate ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => move.mutate()}
          >
            <ShieldBan className="size-3.5" /> Disavow
          </button>
        ) : null}
        {row.status === "disavowed" || row.status === "exported" ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            <ShieldMinus className="size-3.5" /> Remove
          </button>
        ) : null}
      </td>
    </tr>
  );
}
