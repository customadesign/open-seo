import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { CardShell, moreDetailsClass } from "./cardParts";
import {
  changeEventSeverityClass,
  changeEventSourceLabels,
  formatChangeEventDate,
} from "@/client/features/change-events/changeEventPresentation";
import { getChangeEventFeed } from "@/serverFunctions/change-events";

export function ChangeEventsCard({ projectId }: { projectId: string }) {
  const feed = useQuery({
    queryKey: ["changeEvents", projectId, "dashboard"],
    queryFn: () =>
      getChangeEventFeed({
        data: { projectId, unreadOnly: false, limit: 3 },
      }),
  });

  return (
    <CardShell
      title="Important changes"
      stamp={
        feed.data
          ? `${feed.data.unreadCount} unread project ${feed.data.unreadCount === 1 ? "change" : "changes"}`
          : "Loading project changes…"
      }
      action={
        <Link
          to="/p/$projectId/changes"
          params={{ projectId }}
          className={moreDetailsClass}
        >
          View all
        </Link>
      }
    >
      {feed.isPending ? (
        <div className="space-y-2" aria-busy>
          <div className="skeleton h-12" />
          <div className="skeleton h-12" />
        </div>
      ) : feed.isError ? (
        <p className="text-sm text-base-content/60">
          Couldn&rsquo;t load project changes right now.
        </p>
      ) : feed.data.events.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No important changes yet. Future crawl comparisons and report failures
          will appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {feed.data.events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 text-sm">
              <Bell className="mt-0.5 size-4 shrink-0 text-base-content/45" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`badge badge-xs ${changeEventSeverityClass(event.severity)}`}
                  >
                    {changeEventSourceLabels[event.source]}
                  </span>
                  <span className="text-xs text-base-content/50">
                    {formatChangeEventDate(event.occurredAt)}
                  </span>
                </div>
                <p className="mt-1 truncate font-medium" title={event.title}>
                  {event.title}
                </p>
              </div>
              {!event.isRead ? (
                <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}
