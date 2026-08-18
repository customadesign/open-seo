import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Eye,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { ChangeEventLink } from "./ChangeEventLink";
import {
  changeEventBaseline,
  changeEventDelta,
  changeEventMetricLabel,
  changeEventSeverityClass,
  changeEventSourceLabels,
  explainChangeEvent,
  formatChangeEventDate,
  formatChangeEventValue,
} from "./changeEventPresentation";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getChangeEvent,
  markChangeEventRead,
} from "@/serverFunctions/change-events";

export function ChangeEventDetail({
  projectId,
  eventId,
}: {
  projectId: string;
  eventId: string;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["changeEvents", projectId, "detail", eventId],
    // Neither a deleted event nor a malformed id becomes findable by retrying,
    // and the default backoff would hold the page on a spinner for seconds.
    retry: false,
    queryFn: () => getChangeEvent({ data: { projectId, eventId } }),
  });
  const markRead = useMutation({
    mutationFn: () => markChangeEventRead({ data: { projectId, eventId } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["changeEvents", projectId],
      }),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const back = (
    <Link
      to="/p/$projectId/changes"
      params={{ projectId }}
      className="btn btn-ghost btn-sm gap-1 px-2"
    >
      <ArrowLeft className="size-4" />
      Back to Changes
    </Link>
  );

  if (detail.isPending) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  const event = detail.data;
  if (detail.isError || !event) {
    return (
      <div className="px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {back}
          <p className="text-sm text-base-content/70">
            This change is no longer available.
          </p>
        </div>
      </div>
    );
  }

  const delta = changeEventDelta(event);
  const explanation = explainChangeEvent(event);
  const baseline = changeEventBaseline(event.source);
  const previous = event.previousNumericValue;
  const current = event.currentNumericValue;

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {back}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`badge badge-sm ${changeEventSeverityClass(event.severity)}`}
            >
              {event.severity}
            </span>
            <span className="text-xs text-base-content/55">
              {changeEventSourceLabels[event.source]} ·{" "}
              {formatChangeEventDate(event.occurredAt)}
            </span>
            {event.isDismissed ? (
              <span className="badge badge-ghost badge-sm">Dismissed</span>
            ) : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold">{event.title}</h1>
          {/* Report and rank-check failures put a raw provider error here, so it
              is shown as output rather than dressed up as a written summary. */}
          {event.eventType.endsWith(".failed") ? (
            <pre className="mt-3 overflow-x-auto rounded-lg bg-base-200 p-3 text-xs whitespace-pre-wrap">
              {event.summary}
            </pre>
          ) : (
            <p className="mt-1 text-base-content/70">{event.summary}</p>
          )}
        </div>

        {previous !== null && current !== null ? (
          <div className="grid grid-cols-3 gap-4 rounded-xl border border-base-300 bg-base-100 p-5">
            <div>
              <div className="text-xs text-base-content/55">Previous</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {formatChangeEventValue(previous, event.unit)}
              </div>
            </div>
            <div>
              <div className="text-xs text-base-content/55">Current</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {formatChangeEventValue(current, event.unit)}
              </div>
            </div>
            <div>
              <div className="text-xs text-base-content/55">Change</div>
              <div className="mt-1 flex items-center gap-1 text-2xl font-semibold tabular-nums">
                {delta && delta.direction !== "flat" ? (
                  delta.direction === "up" ? (
                    <TrendingUp className="size-5 text-base-content/55" />
                  ) : (
                    <TrendingDown className="size-5 text-base-content/55" />
                  )
                ) : null}
                {delta ? delta.label : "—"}
              </div>
            </div>
          </div>
        ) : null}

        <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-base-300 bg-base-100 p-5 sm:grid-cols-[10rem_1fr]">
          {event.metricKey ? (
            <>
              <dt className="text-sm text-base-content/55">Metric</dt>
              <dd className="text-sm">
                {changeEventMetricLabel(event.metricKey)}
              </dd>
            </>
          ) : null}
          {event.periodStart && event.periodEnd ? (
            <>
              <dt className="text-sm text-base-content/55">Current period</dt>
              <dd className="text-sm tabular-nums">
                {event.periodStart} &rarr; {event.periodEnd}
              </dd>
            </>
          ) : null}
          {event.previousPeriodStart && event.previousPeriodEnd ? (
            <>
              <dt className="text-sm text-base-content/55">Previous period</dt>
              <dd className="text-sm tabular-nums">
                {event.previousPeriodStart} &rarr; {event.previousPeriodEnd}
              </dd>
            </>
          ) : baseline ? (
            <>
              <dt className="text-sm text-base-content/55">Compared with</dt>
              <dd className="text-sm">{baseline}</dd>
            </>
          ) : null}
          <dt className="text-sm text-base-content/55">Detected</dt>
          <dd className="text-sm">{formatChangeEventDate(event.detectedAt)}</dd>
          {explanation ? (
            <>
              <dt className="text-sm text-base-content/55">Why flagged</dt>
              <dd className="text-sm text-base-content/70">{explanation}</dd>
            </>
          ) : null}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <ChangeEventLink
            projectId={projectId}
            event={event}
            className="btn btn-outline btn-sm gap-1"
          >
            Open {changeEventSourceLabels[event.source]}
            <ArrowUpRight className="size-4" />
          </ChangeEventLink>
          {!event.isRead ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              <Eye className="size-4" />
              Mark read
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
