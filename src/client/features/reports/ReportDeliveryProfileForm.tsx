import * as React from "react";
import { type ReportDeliveryFrequency } from "@/types/schemas/report-delivery";
import { type ReportSectionKey } from "@/types/schemas/reports";

const SECTION_KEYS: ReportSectionKey[] = [
  "rankings",
  "gsc",
  "ga4",
  "google_ads",
  "audit",
  "backlinks",
];

const SECTION_LABELS: Record<ReportSectionKey, string> = {
  rankings: "Rankings",
  gsc: "Google Search Console",
  ga4: "Google Analytics",
  google_ads: "Google Ads",
  audit: "Site audit",
  backlinks: "Backlinks",
};

const FREQUENCIES: ReportDeliveryFrequency[] = ["daily", "weekly", "monthly"];

function asFrequency(value: string): ReportDeliveryFrequency {
  return FREQUENCIES.find((frequency) => frequency === value) ?? "monthly";
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type ProfileDraft = {
  name: string;
  frequency: ReportDeliveryFrequency;
  timeZone: string;
  runDay: number;
  runWeekday: number;
  runHour: number;
  isEnabled: boolean;
  attachPdf: boolean;
  includeShareLink: boolean;
  shareLinkTtlDays: number;
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  recipients: string;
  sections: Array<{ key: ReportSectionKey; enabled: boolean }>;
};

export function emptyProfileDraft(): ProfileDraft {
  return {
    name: "",
    frequency: "monthly",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    runDay: 4,
    runWeekday: 1,
    runHour: 9,
    isEnabled: false,
    attachPdf: true,
    includeShareLink: true,
    shareLinkTtlDays: 30,
    brandName: "",
    logoUrl: "",
    primaryColor: "#2563eb",
    accentColor: "#0f172a",
    recipients: "",
    sections: SECTION_KEYS.map((key) => ({ key, enabled: true })),
  };
}

/** Recipients are typed as free text; commas and newlines both separate. */
function parseRecipients(value: string) {
  return [
    ...new Set(
      value
        .split(/[,\n]/u)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].map((email) => ({ email, name: null }));
}

export function draftToPayload(draft: ProfileDraft) {
  return {
    name: draft.name.trim(),
    frequency: draft.frequency,
    timeZone: draft.timeZone.trim(),
    runDay: draft.frequency === "monthly" ? draft.runDay : null,
    runWeekday: draft.frequency === "weekly" ? draft.runWeekday : null,
    runHour: draft.runHour,
    isEnabled: draft.isEnabled,
    attachPdf: draft.attachPdf,
    includeShareLink: draft.includeShareLink,
    shareLinkTtlDays: draft.shareLinkTtlDays,
    branding: {
      brandName: draft.brandName.trim() || null,
      logoUrl: draft.logoUrl.trim() || null,
      primaryColor: draft.primaryColor,
      accentColor: draft.accentColor,
    },
    recipients: parseRecipients(draft.recipients),
    sections: draft.sections,
  };
}

export function ReportDeliveryProfileForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <form
      className="space-y-4 border-t border-base-300 p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-xs">Name</span>
          <input
            className="input input-sm input-bordered"
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Client monthly"
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Time zone</span>
          <input
            className="input input-sm input-bordered"
            required
            value={draft.timeZone}
            onChange={(event) => set("timeZone", event.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Frequency</span>
          <select
            className="select select-sm select-bordered"
            value={draft.frequency}
            onChange={(event) =>
              set("frequency", asFrequency(event.target.value))
            }
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequency[0].toUpperCase() + frequency.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Hour (local)</span>
          <input
            type="number"
            min={0}
            max={23}
            className="input input-sm input-bordered"
            value={draft.runHour}
            onChange={(event) => set("runHour", Number(event.target.value))}
          />
        </label>
        {draft.frequency === "monthly" ? (
          <label className="form-control">
            <span className="label-text text-xs">Day of month (1-28)</span>
            <input
              type="number"
              min={1}
              max={28}
              className="input input-sm input-bordered"
              value={draft.runDay}
              onChange={(event) => set("runDay", Number(event.target.value))}
            />
          </label>
        ) : null}
        {draft.frequency === "weekly" ? (
          <label className="form-control">
            <span className="label-text text-xs">Day of week</span>
            <select
              className="select select-sm select-bordered"
              value={draft.runWeekday}
              onChange={(event) =>
                set("runWeekday", Number(event.target.value))
              }
            >
              {WEEKDAYS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <label className="form-control">
        <span className="label-text text-xs">
          Recipients (comma or line separated)
        </span>
        <textarea
          className="textarea textarea-sm textarea-bordered"
          rows={2}
          value={draft.recipients}
          onChange={(event) => set("recipients", event.target.value)}
          placeholder="client@example.com, seo@example.com"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-xs">Brand name</span>
          <input
            className="input input-sm input-bordered"
            maxLength={120}
            value={draft.brandName}
            onChange={(event) => set("brandName", event.target.value)}
            placeholder="OpenSEO"
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Logo URL (https)</span>
          <input
            className="input input-sm input-bordered"
            value={draft.logoUrl}
            onChange={(event) => set("logoUrl", event.target.value)}
            placeholder="https://cdn.example.com/logo.png"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="color"
            className="h-8 w-12"
            value={draft.primaryColor}
            onChange={(event) => set("primaryColor", event.target.value)}
          />
          Primary color
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="color"
            className="h-8 w-12"
            value={draft.accentColor}
            onChange={(event) => set("accentColor", event.target.value)}
          />
          Accent color
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1 text-xs text-base-content/60">Sections</legend>
        {draft.sections.map((section, index) => (
          <label key={section.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={section.enabled}
              onChange={(event) => {
                const next = [...draft.sections];
                next[index] = { ...section, enabled: event.target.checked };
                set("sections", next);
              }}
            />
            {SECTION_LABELS[section.key]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={draft.isEnabled}
            onChange={(event) => set("isEnabled", event.target.checked)}
          />
          Send on schedule
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={draft.attachPdf}
            onChange={(event) => set("attachPdf", event.target.checked)}
          />
          Attach PDF
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={draft.includeShareLink}
            onChange={(event) => set("includeShareLink", event.target.checked)}
          />
          Include share link
        </label>
        <label className="flex items-center gap-2 text-sm">
          Link expires in
          <input
            type="number"
            min={1}
            max={90}
            className="input input-xs input-bordered w-16"
            value={draft.shareLinkTtlDays}
            onChange={(event) =>
              set("shareLinkTtlDays", Number(event.target.value))
            }
          />
          days
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={isPending}
        >
          {isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : null}
          {submitLabel}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
