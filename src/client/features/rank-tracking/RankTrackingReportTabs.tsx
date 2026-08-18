export const RANK_REPORT_TABS = [
  { id: "keywords", label: "Keywords" },
  { id: "history", label: "History" },
  { id: "distribution", label: "Distribution" },
  { id: "cannibalization", label: "Cannibalization" },
  { id: "tags", label: "Tags" },
  { id: "pages", label: "Pages" },
  { id: "snippets", label: "Snippets" },
  { id: "competitors", label: "Competitors" },
  { id: "visibility", label: "Visibility" },
] as const;

export type RankReportTab = (typeof RANK_REPORT_TABS)[number]["id"];

export function RankTrackingReportTabs({
  value,
  onChange,
  historyAvailable,
}: {
  value: RankReportTab;
  onChange: (tab: RankReportTab) => void;
  historyAvailable: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Rank tracking reports"
      className="flex min-w-0 items-stretch gap-1 overflow-x-auto px-4 pt-3"
    >
      {RANK_REPORT_TABS.map((tab) => {
        if (tab.id === "history" && !historyAvailable) return null;
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`btn btn-xs shrink-0 ${
              active ? "btn-active" : "btn-ghost text-base-content/60"
            }`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
