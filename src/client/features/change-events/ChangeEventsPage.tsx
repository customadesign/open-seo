import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Eye, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChangeEventLink } from "./ChangeEventLink";
import {
  changeEventSeverityClass,
  changeEventSourceLabels,
  formatChangeEventDate,
} from "./changeEventPresentation";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  dismissChangeEvent,
  getChangeEventFeed,
  markChangeEventRead,
} from "@/serverFunctions/change-events";
import {
  changeEventSourceSchema,
  type ChangeEventSource,
} from "@/types/schemas/change-events";
import { CHANGE_EVENT_SOURCES } from "@/shared/change-events";

const sources = CHANGE_EVENT_SOURCES.map(
  (source) => [source, changeEventSourceLabels[source]] as const,
);

export function ChangeEventsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<ChangeEventSource | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const queryKey = ["changeEvents", projectId, source, unreadOnly] as const;
  const feed = useQuery({
    queryKey,
    queryFn: () =>
      getChangeEventFeed({
        data: {
          projectId,
          source: source === "all" ? undefined : source,
          unreadOnly,
          limit: 100,
        },
      }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["changeEvents", projectId] });
  const markRead = useMutation({
    mutationFn: (eventId: string) =>
      markChangeEventRead({ data: { projectId, eventId } }),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const dismiss = useMutation({
    mutationFn: (eventId: string) =>
      dismissChangeEvent({ data: { projectId, eventId } }),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Bell className="size-6" />
              Changes
            </h1>
            <p className="mt-1 text-sm text-base-content/70">
              Important SEO movement, explained in one project feed.
            </p>
          </div>
          {feed.data ? (
            <span className="badge badge-outline">
              {feed.data.unreadCount} unread
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 rounded-xl border border-base-300 bg-base-100 p-4">
          <label className="form-control w-full max-w-xs">
            <span className="label-text mb-1 text-xs">Source</span>
            <select
              className="select select-bordered select-sm"
              value={source}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSource(
                  value === "all"
                    ? "all"
                    : changeEventSourceSchema.parse(value),
                );
              }}
            >
              <option value="all">All sources</option>
              {sources.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="label mt-auto cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            <span className="label-text">Unread only</span>
          </label>
        </div>

        {feed.isPending ? (
          <div className="space-y-3" aria-busy>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="skeleton h-36" />
            ))}
          </div>
        ) : feed.isError ? (
          <div className="alert alert-error">
            {getStandardErrorMessage(feed.error)}
          </div>
        ) : feed.data.events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-base-300 bg-base-100 px-6 py-16 text-center">
            <Check className="mx-auto size-10 text-success" />
            <h2 className="mt-3 font-semibold">
              No changes need your attention
            </h2>
            <p className="mt-1 text-sm text-base-content/60">
              New crawl comparisons and report failures will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {feed.data.events.map((event) => (
              <article
                key={event.id}
                className={`rounded-xl border bg-base-100 p-5 ${
                  event.isRead
                    ? "border-base-300"
                    : "border-primary/30 shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
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
                      {!event.isRead ? (
                        <span
                          className="size-2 rounded-full bg-primary"
                          aria-label="Unread"
                        />
                      ) : null}
                    </div>
                    <h2 className="mt-2 font-semibold">{event.title}</h2>
                    <p className="mt-1 text-sm text-base-content/70">
                      {event.summary}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-square shrink-0"
                    aria-label={`Dismiss ${event.title}`}
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(event.id)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <ChangeEventLink
                    projectId={projectId}
                    event={event}
                    className="btn btn-outline btn-sm"
                  >
                    View details
                  </ChangeEventLink>
                  {!event.isRead ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(event.id)}
                    >
                      <Eye className="size-4" />
                      Mark read
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
