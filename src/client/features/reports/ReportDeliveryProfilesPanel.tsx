import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createReportDeliveryProfile,
  deleteReportDeliveryProfile,
  getReportDeliveryProfiles,
  updateReportDeliveryProfile,
} from "@/serverFunctions/report-delivery";
import {
  draftToPayload,
  emptyProfileDraft,
  ReportDeliveryProfileForm,
  type ProfileDraft,
} from "./ReportDeliveryProfileForm";

type Profiles = Awaited<ReturnType<typeof getReportDeliveryProfiles>>;
type Profile = Profiles["profiles"][number];

function scheduleSummary(profile: Profile): string {
  const at = `${String(profile.runHour).padStart(2, "0")}:00 ${profile.timeZone}`;
  if (profile.frequency === "daily") return `Daily at ${at}`;
  if (profile.frequency === "weekly") {
    return `Weekly on day ${profile.runWeekday ?? 0} at ${at}`;
  }
  return `Monthly on day ${profile.runDay ?? 1} at ${at}`;
}

function profileToDraft(profile: Profile): ProfileDraft {
  const defaults = emptyProfileDraft();
  return {
    ...defaults,
    name: profile.name,
    frequency: profile.frequency,
    timeZone: profile.timeZone,
    runDay: profile.runDay ?? defaults.runDay,
    runWeekday: profile.runWeekday ?? defaults.runWeekday,
    runHour: profile.runHour,
    isEnabled: profile.isEnabled,
    attachPdf: profile.attachPdf,
    includeShareLink: profile.includeShareLink,
    shareLinkTtlDays: profile.shareLinkTtlDays,
    brandName: profile.branding.brandName ?? "",
    logoUrl: profile.branding.logoUrl ?? "",
    primaryColor: profile.branding.primaryColor ?? defaults.primaryColor,
    accentColor: profile.branding.accentColor ?? defaults.accentColor,
    recipients: profile.recipients.map((one) => one.email).join(", "),
    sections: defaults.sections.map((section) => ({
      key: section.key,
      enabled:
        profile.sections.find((saved) => saved.key === section.key)?.enabled ??
        section.enabled,
    })),
  };
}

export function ReportDeliveryProfilesPanel({
  projectId,
}: {
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["report-delivery-profiles", projectId];
  const profilesQuery = useQuery({
    queryKey,
    queryFn: () => getReportDeliveryProfiles({ data: { projectId } }),
  });
  const [editing, setEditing] = React.useState<{
    profileId: string | null;
    draft: ProfileDraft;
  } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const onError = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("No delivery profile is being edited");
      const payload = { projectId, ...draftToPayload(editing.draft) };
      return editing.profileId
        ? updateReportDeliveryProfile({
            data: { ...payload, profileId: editing.profileId },
          })
        : createReportDeliveryProfile({ data: payload });
    },
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
      toast.success("Delivery profile saved");
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (profileId: string) =>
      deleteReportDeliveryProfile({ data: { projectId, profileId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Delivery profile removed");
    },
    onError,
  });

  const providers = profilesQuery.data?.providers;
  const delivery = profilesQuery.data?.delivery;
  const profiles = profilesQuery.data?.profiles ?? [];
  const allRecipients = profiles.flatMap((profile) => profile.recipients);
  const heldBack = allRecipients.filter((one) => !one.isAllowed).length;

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <span className="flex items-center gap-2.5">
          <Mail className="size-5 text-primary" />
          <span>
            <span className="block text-sm font-semibold">Delivery</span>
            <span className="block text-xs text-base-content/55">
              {profiles.length === 0
                ? "No delivery profiles yet"
                : `${profiles.length} profile${profiles.length === 1 ? "" : "s"}`}
            </span>
          </span>
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setEditing({ profileId: null, draft: emptyProfileDraft() })
          }
        >
          <Plus className="size-4" />
          New profile
        </button>
      </div>

      {delivery?.testMode ? (
        <p className="mx-4 mb-4 rounded-lg bg-warning/10 p-3 text-xs text-base-content/70 sm:mx-5">
          <span className="font-medium">Delivery test mode is on.</span>{" "}
          {delivery.allowlistSize === 0
            ? "REPORT_TEST_RECIPIENTS is empty, so scheduled reports mail nobody — every recipient is recorded as skipped."
            : `Scheduled reports only reach the ${delivery.allowlistSize} address(es) in REPORT_TEST_RECIPIENTS; ${heldBack} of ${allRecipients.length} profile recipients are recorded as skipped.`}{" "}
          Set <code>REPORT_DELIVERY_TEST_MODE=false</code> to allow client
          delivery. See docs/REPORT_DELIVERY.md.
        </p>
      ) : null}

      {providers && providers.email !== "configured" ? (
        <p className="mx-4 mb-4 rounded-lg bg-warning/10 p-3 text-xs text-base-content/70 sm:mx-5">
          Email delivery is not configured for this deployment. Profiles can be
          saved, but nothing is sent until the provider environment variables
          are set. See docs/REPORT_DELIVERY.md.
        </p>
      ) : null}

      {profiles.length > 0 ? (
        <ul className="divide-y divide-base-300 border-t border-base-300">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{profile.name}</p>
                <p className="text-xs text-base-content/55">
                  {scheduleSummary(profile)} · {profile.recipients.length}{" "}
                  recipient
                  {profile.recipients.length === 1 ? "" : "s"} ·{" "}
                  {profile.isEnabled
                    ? `next ${profile.nextRunAt ?? "unscheduled"}`
                    : "paused"}
                </p>
                {profile.recipients.some((one) => !one.isAllowed) ? (
                  <p className="text-xs text-warning">
                    {profile.recipients.filter((one) => !one.isAllowed).length}{" "}
                    recipient(s) held back by delivery test mode
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() =>
                    setEditing({
                      profileId: profile.id,
                      draft: profileToDraft(profile),
                    })
                  }
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(profile.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <ReportDeliveryProfileForm
          draft={editing.draft}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onSubmit={() => saveMutation.mutate()}
          onCancel={() => setEditing(null)}
          isPending={saveMutation.isPending}
          submitLabel={editing.profileId ? "Save profile" : "Create profile"}
        />
      ) : null}
    </section>
  );
}
