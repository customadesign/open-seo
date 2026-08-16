import type {
  ChangeEventSeverity,
  ChangeEventSource,
} from "@/types/schemas/change-events";

export const changeEventSourceLabels: Record<ChangeEventSource, string> = {
  audit: "Site Audit",
  rank_tracking: "Rank Tracking",
  backlinks: "Backlinks",
  gsc: "Search Console",
  ga4: "Google Analytics",
  local_seo: "Local SEO",
  reports: "Reports",
  ai_visibility: "AI Visibility",
  system: "OpenSEO",
};

export function changeEventSeverityClass(severity: ChangeEventSeverity) {
  if (severity === "critical") return "badge-error";
  if (severity === "warning") return "badge-warning";
  if (severity === "opportunity") return "badge-success";
  return "badge-ghost";
}

export function formatChangeEventDate(value: string) {
  const parsed = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
