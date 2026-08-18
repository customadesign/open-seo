import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getRankCannibalizationReport,
  getRankDistributionReport,
  getRankPagesReport,
  getRankSnippetsReport,
  getRankTagsReport,
  tagTrackingKeywords,
} from "@/serverFunctions/rank-tracking";
import { parseSavedKeywordTagInput } from "@/shared/saved-keyword-tags";
import { RANK_BAND_LABELS, RANK_BANDS } from "@/shared/rank-tracking-reports";
import { RankTrackingOverview } from "./RankTrackingOverview";
import {
  EmptyState,
  formatPosition,
  formatSigned,
  LoadingState,
  ReportTable,
} from "./RankTrackingReportUi";

export function DistributionReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankDistribution", projectId, configId, device],
    queryFn: () =>
      getRankDistributionReport({
        data: { projectId, configId, device },
      }),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return <EmptyState>No distribution data yet.</EmptyState>;

  return (
    <div className="space-y-4">
      <RankTrackingOverview
        device={device}
        projectId={projectId}
        configId={configId}
      />
      <ReportTable
        headers={["Band", "Now", "Entered", "Left"]}
        rows={RANK_BANDS.map((band) => [
          RANK_BAND_LABELS[band],
          data.current[band],
          data.movement[band].entered,
          data.movement[band].left,
        ])}
      />
    </div>
  );
}

export function CannibalizationReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankCannibalization", projectId, configId, device],
    queryFn: () =>
      getRankCannibalizationReport({
        data: { projectId, configId, device },
      }),
  });

  if (isLoading) return <LoadingState />;
  if (!data || data.findings.length === 0) {
    return (
      <EmptyState>
        No URL cannibalization in stored snapshots. A single one-way URL change
        (redirect or page move) is not reported.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-content/60">
        {data.findings.length} of {data.scannedKeywords} keywords flipped
        between two or more ranking URLs across {data.runCount} checks.
      </p>
      <ReportTable
        headers={["Keyword", "Position", "URLs", "Flips"]}
        rows={data.findings.map((row) => [
          row.keyword,
          formatPosition(row.currentPosition),
          row.competingUrls
            .map((url) => `${url.url} (${url.snapshotCount})`)
            .join(" · "),
          row.transitionCount,
        ])}
      />
    </div>
  );
}

export function TagsReportPanel({
  projectId,
  configId,
  device,
  readOnly,
  keywordIds,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
  readOnly: boolean;
  keywordIds: string[];
}) {
  const queryClient = useQueryClient();
  const [tagInput, setTagInput] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["rankTags", projectId, configId, device],
    queryFn: () => getRankTagsReport({ data: { projectId, configId, device } }),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-base-content/60">
        Tags come from the project saved-keyword list. Matching uses the
        tracker&apos;s keyword + market, so the same tag names apply here and on
        Saved Keywords.
      </p>
      {data && data.tags.length > 0 ? (
        <ReportTable
          headers={[
            "Tag",
            "Keywords",
            "Visibility",
            "Change",
            "Avg position",
            "Est. traffic",
          ]}
          rows={data.tags.map((tag) => [
            tag.name,
            tag.keywordCount,
            tag.visibility == null ? "—" : `${tag.visibility.toFixed(1)}%`,
            formatSigned(tag.visibilityDelta),
            tag.averagePosition == null ? "—" : tag.averagePosition.toFixed(1),
            tag.estimatedTraffic == null
              ? "—"
              : Math.round(tag.estimatedTraffic).toLocaleString(),
          ])}
        />
      ) : (
        <EmptyState>
          No tagged tracked keywords yet. Save these keywords with tags, or add
          a tag below.
        </EmptyState>
      )}
      {data && data.untaggedKeywordCount > 0 ? (
        <p className="text-xs text-base-content/60">
          {data.untaggedKeywordCount} tracked keyword
          {data.untaggedKeywordCount === 1 ? "" : "s"} have no tag.
        </p>
      ) : null}
      {!readOnly ? (
        <TagAllForm
          tagInput={tagInput}
          onTagInputChange={setTagInput}
          onApply={async (tags) => {
            if (keywordIds.length === 0) {
              toast.error("Add keywords before tagging");
              return;
            }
            await tagTrackingKeywords({
              data: { projectId, configId, keywordIds, tags },
            });
            await queryClient.invalidateQueries({
              queryKey: ["rankTags", projectId, configId],
            });
            toast.success("Tags applied to tracked keywords");
            setTagInput("");
          }}
        />
      ) : null}
    </div>
  );
}

function TagAllForm({
  tagInput,
  onTagInputChange,
  onApply,
}: {
  tagInput: string;
  onTagInputChange: (value: string) => void;
  onApply: (tags: string[]) => Promise<void>;
}) {
  const apply = useMutation({
    mutationFn: async () => {
      const tags = parseSavedKeywordTagInput(tagInput);
      if (tags.length === 0) {
        throw new Error("Enter at least one tag");
      }
      await onApply(tags);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Could not apply tags",
      );
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply.mutate();
      }}
    >
      <label className="form-control">
        <span className="label-text text-xs">
          Add tags to all tracked keywords
        </span>
        <input
          className="input input-sm input-bordered w-64"
          value={tagInput}
          onChange={(event) => onTagInputChange(event.target.value)}
          placeholder="Local, Brand"
        />
      </label>
      <button
        type="submit"
        className="btn btn-sm btn-primary"
        disabled={apply.isPending}
      >
        {apply.isPending ? "Saving…" : "Apply"}
      </button>
    </form>
  );
}

export function PagesReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankPages", projectId, configId, device],
    queryFn: () =>
      getRankPagesReport({ data: { projectId, configId, device } }),
  });

  if (isLoading) return <LoadingState />;
  if (!data || data.pages.length === 0) {
    return <EmptyState>No ranking URLs in the latest check.</EmptyState>;
  }

  return (
    <ReportTable
      headers={[
        "Page",
        "Keywords",
        "Best",
        "Average",
        "Est. traffic",
        "Keyword Δ",
      ]}
      rows={data.pages.map((page) => [
        page.url,
        page.keywordCount,
        formatPosition(page.bestPosition),
        page.averagePosition == null ? "—" : page.averagePosition.toFixed(1),
        page.estimatedTraffic == null
          ? "—"
          : Math.round(page.estimatedTraffic).toLocaleString(),
        formatSigned(page.keywordCountChange, 0),
      ])}
    />
  );
}

export function SnippetsReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankSnippets", projectId, configId, device],
    queryFn: () =>
      getRankSnippetsReport({ data: { projectId, configId, device } }),
  });

  if (isLoading) return <LoadingState />;
  if (!data || data.rows.length === 0) {
    return (
      <EmptyState>
        No notable SERP features in stored snapshots. Ownership is not stored —
        this list is presence only.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-content/60">
        Stored checks record which features appeared on the SERP, not whether
        this domain owns them.
      </p>
      <ReportTable
        headers={["Keyword", "Position", "Features", "Gained", "Lost"]}
        rows={data.rows.map((row) => [
          row.keyword,
          formatPosition(row.position),
          row.features.join(", ") || "—",
          row.gained.join(", ") || "—",
          row.lost.join(", ") || "—",
        ])}
      />
    </div>
  );
}
