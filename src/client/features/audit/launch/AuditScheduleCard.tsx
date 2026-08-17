import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { auditScheduleSkipReasonLabel } from "@/client/features/audit/launch/auditScheduleUi";
import { MIN_PAGES } from "@/client/features/audit/launch/types";
import { formatStartedAt } from "@/client/features/audit/shared";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getAuditSchedule, saveAuditSchedule } from "@/serverFunctions/audit";
import { DEFAULT_AUDIT_PAGES } from "@/shared/audit-limits";
import {
  AUDIT_SCHEDULE_INTERVALS,
  type AuditScheduleInterval,
} from "@/shared/audit-schedule";
import { scheduleLabel } from "@/shared/rank-tracking";

/**
 * Configure or pause the project's recurring audit.
 *
 * A project with no schedule row renders the same form with defaults — paused,
 * manual cadence — so arming one is an explicit act, never a side effect of
 * visiting the page.
 */
export function AuditScheduleCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const scheduleQuery = useQuery({
    queryKey: ["audit-schedule", projectId],
    queryFn: () => getAuditSchedule({ data: { projectId } }),
  });

  if (scheduleQuery.isLoading) {
    return (
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Scheduled audits</h2>
          <span className="loading loading-spinner loading-sm" />
        </div>
      </div>
    );
  }

  return (
    <ScheduleForm
      // Remount when the saved schedule changes so the inputs follow the
      // server's normalized values (clamped pages, resolved URL).
      key={scheduleQuery.data?.updatedAt ?? "new"}
      projectId={projectId}
      schedule={scheduleQuery.data ?? null}
      onSaved={() =>
        queryClient.invalidateQueries({
          queryKey: ["audit-schedule", projectId],
        })
      }
    />
  );
}

type Schedule = Awaited<ReturnType<typeof getAuditSchedule>>;

function ScheduleForm({
  projectId,
  schedule,
  onSaved,
}: {
  projectId: string;
  schedule: Schedule;
  onSaved: () => void;
}) {
  const [startUrl, setStartUrl] = useState(schedule?.startUrl ?? "");
  const [cadence, setCadence] = useState<AuditScheduleInterval>(
    schedule?.scheduleInterval ?? "manual",
  );
  const [isActive, setIsActive] = useState(schedule?.isActive ?? false);
  const [maxPages, setMaxPages] = useState(
    String(schedule?.maxPages ?? DEFAULT_AUDIT_PAGES),
  );
  const [runLighthouse, setRunLighthouse] = useState(
    schedule?.lighthouseStrategy !== "none",
  );
  const skipReason = auditScheduleSkipReasonLabel(schedule?.lastSkipReason);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveAuditSchedule({
        data: {
          projectId,
          startUrl,
          maxPages: Number.parseInt(maxPages, 10) || DEFAULT_AUDIT_PAGES,
          lighthouseStrategy: runLighthouse ? "auto" : "none",
          scheduleInterval: cadence,
          isActive,
        },
      }),
    onSuccess: () => {
      onSaved();
      toast.success(
        isActive ? "Recurring audit saved" : "Recurring audit paused",
      );
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not save the schedule"),
      ),
  });

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-4">
        <div>
          <h2 className="card-title text-base">Scheduled audits</h2>
          <p className="text-sm text-base-content/60">
            Re-crawl this site on a cadence. Each run reuses the settings below
            and appears in the history, with the same comparison to the previous
            audit a manual run produces.
          </p>
        </div>

        {skipReason ? (
          <div className="alert alert-warning py-2 text-sm">
            <AlertTriangle className="size-4" />
            <span>
              The last scheduled run started no audit — {skipReason}. Fix the
              cause to resume collection.
            </span>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="form-control">
            <span className="label-text mb-1 text-sm font-medium">
              Start URL
            </span>
            <input
              className="input input-bordered"
              placeholder="https://example.com"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 text-sm font-medium">Cadence</span>
            <select
              className="select select-bordered"
              value={cadence}
              onChange={(event) => {
                const value = event.target.value;
                if (!isAuditScheduleInterval(value)) return;
                setCadence(value);
                // An inactive cadence is the only meaning "manual" can have.
                if (value === "manual") setIsActive(false);
              }}
            >
              {AUDIT_SCHEDULE_INTERVALS.map((value) => (
                <option key={value} value={value}>
                  {value === "manual" ? "Manual only" : scheduleLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text mb-1 text-sm font-medium">
              Max pages
            </span>
            <input
              className="input input-bordered"
              type="number"
              min={MIN_PAGES}
              step={1}
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-primary"
                checked={runLighthouse}
                onChange={(event) => setRunLighthouse(event.target.checked)}
              />
              <span className="label-text">Include Lighthouse</span>
            </label>
            <label className="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                className="toggle toggle-warning"
                checked={isActive}
                disabled={cadence === "manual"}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              <span className="label-text">Recurring active</span>
            </label>
          </div>
        </div>

        <ScheduleState schedule={schedule} />

        <div className="flex justify-end">
          <button
            className="btn btn-sm"
            type="button"
            disabled={saveMutation.isPending || !startUrl.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {schedule?.isActive && !isActive
              ? "Pause schedule"
              : "Save schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleState({ schedule }: { schedule: Schedule }) {
  if (!schedule) return null;

  return (
    <p className="text-xs text-base-content/60">
      {schedule.isActive && schedule.nextRunAt
        ? `Next run ${formatStartedAt(schedule.nextRunAt)}.`
        : "Paused — no runs are scheduled."}
      {schedule.lastRunAt
        ? ` Last started ${formatStartedAt(schedule.lastRunAt)}.`
        : " No scheduled run yet."}
    </p>
  );
}

function isAuditScheduleInterval(
  value: string,
): value is AuditScheduleInterval {
  return AUDIT_SCHEDULE_INTERVALS.some((interval) => interval === value);
}
