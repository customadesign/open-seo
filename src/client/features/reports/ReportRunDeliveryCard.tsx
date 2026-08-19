import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  dismissChangeEvent,
  getChangeEvents,
  markChangeEventRead,
} from "@/serverFunctions/change-events";
import {
  createReportShareLink,
  getReportDeliveries,
  getReportShareLinks,
  retryReportDeliveries,
  revokeReportShareLink,
  sendTestReportDelivery,
} from "@/serverFunctions/report-delivery";

const DELIVERY_STATUS_CLASS: Record<string, string> = {
  sent: "badge-success",
  pending: "badge-ghost",
  failed: "badge-error",
  skipped: "badge-warning",
};

function shortDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ReportRunDeliveryCard({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const queryClient = useQueryClient();
  const deliveriesKey = ["report-deliveries", projectId, runId];
  const sharesKey = ["report-share-links", projectId, runId];
  const alertsKey = ["report-change-events", projectId];
  const [testEmail, setTestEmail] = React.useState("");

  const deliveriesQuery = useQuery({
    queryKey: deliveriesKey,
    queryFn: () => getReportDeliveries({ data: { projectId, runId } }),
  });
  const sharesQuery = useQuery({
    queryKey: sharesKey,
    queryFn: () => getReportShareLinks({ data: { projectId, runId } }),
  });
  const alertsQuery = useQuery({
    queryKey: alertsKey,
    queryFn: () =>
      getChangeEvents({
        data: { projectId, source: "reports", unreadOnly: false, limit: 5 },
      }),
  });

  const onError = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));
  const invalidate = (queryKey: readonly unknown[]) =>
    queryClient.invalidateQueries({ queryKey });

  const shareMutation = useMutation({
    mutationFn: () =>
      createReportShareLink({
        data: { projectId, runId, expiresInDays: 30 },
      }),
    onSuccess: async (result) => {
      await invalidate(sharesKey);
      if (result.url) {
        await navigator.clipboard.writeText(result.url).catch(() => undefined);
        toast.success("Share link copied to your clipboard");
        return;
      }
      // Without a configured app URL the caller still gets the raw token.
      toast.success(`Share token created: ${result.token}`);
    },
    onError,
  });

  const revokeMutation = useMutation({
    mutationFn: (shareLinkId: string) =>
      revokeReportShareLink({ data: { projectId, shareLinkId } }),
    onSuccess: async () => {
      await invalidate(sharesKey);
      toast.success("Share link revoked");
    },
    onError,
  });

  const retryMutation = useMutation({
    mutationFn: () => retryReportDeliveries({ data: { projectId, runId } }),
    onSuccess: async (result) => {
      await invalidate(deliveriesKey);
      // A retry re-checks the delivery guard, so "0 sent, 0 failed" needs the
      // held-back count to be readable.
      const outcome = [`${result.sent} sent`, `${result.failed} failed`];
      if (result.skipped > 0) {
        outcome.push(`${result.skipped} held back by test mode`);
      }
      toast.success(
        `Retried ${result.reset} delivery${result.reset === 1 ? "" : "ies"}: ${outcome.join(", ")}`,
      );
    },
    onError,
  });

  const testMutation = useMutation({
    mutationFn: () =>
      sendTestReportDelivery({
        data: { projectId, runId, profileId: null, email: testEmail },
      }),
    onSuccess: async () => {
      setTestEmail("");
      await invalidate(deliveriesKey);
      toast.success("Test report sent");
    },
    onError,
  });

  const alertMutation = useMutation({
    mutationFn: (input: { eventId: string; dismiss: boolean }) =>
      input.dismiss
        ? dismissChangeEvent({ data: { projectId, eventId: input.eventId } })
        : markChangeEventRead({ data: { projectId, eventId: input.eventId } }),
    onSuccess: () => invalidate(alertsKey),
    onError,
  });

  const deliveries = deliveriesQuery.data ?? [];
  const shareLinks = sharesQuery.data ?? [];
  const alerts = alertsQuery.data?.events ?? [];

  return (
    <section className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Delivery for this report</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm"
            disabled={shareMutation.isPending}
            onClick={() => shareMutation.mutate()}
          >
            <Link2 className="size-4" />
            Create share link
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={
              retryMutation.isPending ||
              !deliveries.some((delivery) => delivery.status === "failed")
            }
            onClick={() => retryMutation.mutate()}
          >
            <RefreshCw className="size-4" />
            Retry failed
          </button>
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          testMutation.mutate();
        }}
      >
        <input
          type="email"
          required
          className="input input-sm input-bordered w-64"
          placeholder="your@address.com"
          value={testEmail}
          onChange={(event) => setTestEmail(event.target.value)}
        />
        <button
          type="submit"
          className="btn btn-sm"
          disabled={testMutation.isPending}
        >
          <Send className="size-4" />
          Send test
        </button>
        <span className="text-xs text-base-content/55">
          Test reports only go to your own address or an allowlisted one.
        </span>
      </form>

      {deliveries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td className="whitespace-nowrap">
                    {delivery.email}
                    {delivery.isTest ? (
                      <span className="badge badge-ghost badge-xs ml-2">
                        test
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`badge badge-sm ${DELIVERY_STATUS_CLASS[delivery.status] ?? "badge-ghost"}`}
                    >
                      {delivery.status}
                    </span>
                  </td>
                  <td>{delivery.attempts}</td>
                  <td className="text-xs text-base-content/60">
                    {delivery.errorMessage ?? shortDate(delivery.sentAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-base-content/55">
          No deliveries recorded for this report yet.
        </p>
      )}

      {shareLinks.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {shareLinks.map((link) => (
            <li key={link.id} className="flex items-center gap-3">
              <span className="text-base-content/60">
                Expires {shortDate(link.expiresAt)} · {link.accessCount} view
                {link.accessCount === 1 ? "" : "s"}
                {link.revokedAt ? " · revoked" : ""}
              </span>
              {link.revokedAt ? null : (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(link.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {alerts.length > 0 ? (
        <div className="space-y-1 border-t border-base-300 pt-3">
          <p className="text-xs font-medium text-base-content/70">
            Recent report alerts
          </p>
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className={alert.isRead ? "text-base-content/50" : ""}>
                {alert.title}: {alert.summary}
              </span>
              {alert.isRead ? null : (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() =>
                    alertMutation.mutate({ eventId: alert.id, dismiss: false })
                  }
                >
                  Mark read
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() =>
                  alertMutation.mutate({ eventId: alert.id, dismiss: true })
                }
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
