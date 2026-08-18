import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addOnPageTarget,
  estimateOnPageRun,
  getOnPageOverview,
  importOnPageTargets,
  runOnPageChecker,
} from "@/serverFunctions/on-page";
import {
  MAX_ON_PAGE_PAGES_PER_RUN,
  ON_PAGE_BUCKET_LABELS,
  ON_PAGE_BUCKETS,
} from "@/shared/on-page";
import { OnPageDetail } from "./OnPageDetail";

export function OnPagePage({
  projectId,
  pageId,
}: {
  projectId: string;
  pageId?: string;
}) {
  if (pageId) {
    return <OnPageDetail projectId={projectId} pageId={pageId} />;
  }
  return <OnPageOverview projectId={projectId} />;
}

function OnPageOverview({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accessQuery = useWorkspaceAccess();
  const readOnly = accessQuery.data?.role === "client";
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ["onPageOverview", projectId],
    queryFn: () => getOnPageOverview({ data: { projectId } }),
  });
  const estimateQuery = useQuery({
    queryKey: ["onPageEstimate", projectId],
    queryFn: () => estimateOnPageRun({ data: { projectId } }),
    enabled: confirmOpen,
  });

  const overview = overviewQuery.data;
  const buckets = useMemo(
    () =>
      ON_PAGE_BUCKETS.map((bucket) => ({
        bucket,
        label: ON_PAGE_BUCKET_LABELS[bucket],
        count: overview?.byBucket[bucket] ?? 0,
      })),
    [overview],
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["onPageOverview", projectId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["onPageEstimate", projectId],
    });
  };

  const importMutation = useMutation({
    mutationFn: () => importOnPageTargets({ data: { projectId } }),
    onSuccess: async (result) => {
      await invalidate();
      toast.success(
        `Imported ${result.importedKeywords} keywords across ${result.importedPages} pages`,
      );
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const addMutation = useMutation({
    mutationFn: () => addOnPageTarget({ data: { projectId, url, keyword } }),
    onSuccess: async () => {
      setUrl("");
      setKeyword("");
      await invalidate();
      toast.success("Target page saved");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const runMutation = useMutation({
    mutationFn: () => runOnPageChecker({ data: { projectId } }),
    onSuccess: async (result) => {
      setConfirmOpen(false);
      await invalidate();
      toast.success(
        `Found ${result.ideasDetected} ideas on ${result.pagesProcessed} pages`,
      );
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">On-page ideas</h1>
            <p className="mt-1 max-w-2xl text-sm text-base-content/70">
              A per-URL task list from the latest site audit, a top-10 content
              comparison, and rank-tracking conflicts. Semantic, backlinks, UX,
              and SERP-feature ideas are not in this slice.
            </p>
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Import from rank tracking
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setConfirmOpen(true)}
                disabled={(overview?.targets.length ?? 0) === 0}
              >
                Run checker
              </button>
            </div>
          ) : null}
        </header>

        {overview && !overview.audit ? (
          <div className="alert alert-warning text-sm">
            <AlertTriangle className="size-4" />
            <span>
              No completed site audit yet, so the Technical bucket has no ideas
              to map. Run a site audit, then re-run this checker.
            </span>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Unresolved ideas"
            value={overview?.totalIdeas ?? 0}
          />
          <StatCard
            label="Target pages"
            value={overview?.targets.length ?? 0}
          />
          {buckets
            .filter((bucket) =>
              ["technical", "content", "strategy"].includes(bucket.bucket),
            )
            .map((bucket) => (
              <StatCard
                key={bucket.bucket}
                label={bucket.label}
                value={bucket.count}
              />
            ))}
        </div>

        {!readOnly ? (
          <form
            className="card border border-base-300 bg-base-100"
            onSubmit={(event) => {
              event.preventDefault();
              if (!url.trim() || !keyword.trim()) {
                toast.error("Enter a page URL and a target keyword");
                return;
              }
              addMutation.mutate();
            }}
          >
            <div className="card-body gap-3 p-4">
              <h2 className="text-sm font-semibold">Add a target page</h2>
              <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                <input
                  className="input input-bordered w-full"
                  aria-label="Page URL"
                  placeholder="https://example.com/services"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <input
                  className="input input-bordered w-full"
                  aria-label="Target keyword"
                  placeholder="target keyword"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={addMutation.isPending}
                >
                  {addMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add
                </button>
              </div>
            </div>
          </form>
        ) : null}

        <section className="card border border-base-300 bg-base-100">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Keywords</th>
                  <th>Ideas</th>
                  <th>Technical</th>
                  <th>Content</th>
                  <th>Strategy</th>
                </tr>
              </thead>
              <tbody>
                {overviewQuery.isLoading ? (
                  <tr>
                    <td colSpan={6}>
                      <Loader2 className="size-4 animate-spin" />
                    </td>
                  </tr>
                ) : overview?.targets.length ? (
                  overview.targets.map((page) => (
                    <tr
                      key={page.id}
                      className="cursor-pointer hover:bg-base-200/60"
                      onClick={() =>
                        void navigate({
                          to: "/p/$projectId/on-page",
                          params: { projectId },
                          search: { page: page.id },
                        })
                      }
                    >
                      <td className="max-w-xl truncate font-medium">
                        {page.url}
                      </td>
                      <td>{page.keywordCount}</td>
                      <td>{page.ideaCount}</td>
                      <td>{page.byBucket.technical ?? 0}</td>
                      <td>{page.byBucket.content ?? 0}</td>
                      <td>{page.byBucket.strategy ?? 0}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="text-sm text-base-content/60">
                      No target pages yet. Import ranking URLs from rank
                      tracking or add a page and keyword.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {overview?.latestRun ? (
          <p className="text-xs text-base-content/50">
            Last run {new Date(overview.latestRun.startedAt).toLocaleString()} ·{" "}
            {overview.latestRun.ideasDetected} ideas ·{" "}
            {overview.latestRun.serpFetches} SERP fetches
          </p>
        ) : null}
      </div>

      {confirmOpen ? (
        <dialog className="modal modal-open">
          <div className="modal-box space-y-4">
            <h3 className="text-lg font-semibold">Run on-page checker</h3>
            <p className="text-sm text-base-content/70">
              Content comparison fetches the current top 10 for each target
              keyword, then parses those pages. Cached SERPs from today are
              free. At most {MAX_ON_PAGE_PAGES_PER_RUN} pages are compared per
              run.
            </p>
            {estimateQuery.isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : estimateQuery.data ? (
              <p className="text-sm">
                {estimateQuery.data.pagesToProcess} pages ·{" "}
                {estimateQuery.data.uncachedKeywords} uncached SERPs · ~
                {estimateQuery.data.costCredits} credits (~$
                {estimateQuery.data.costUsd.toFixed(3)})
              </p>
            ) : (
              <p className="text-sm text-error">Could not estimate cost.</p>
            )}
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={runMutation.isPending || !estimateQuery.data}
                onClick={() => runMutation.mutate()}
              >
                {runMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Approve and run
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setConfirmOpen(false)}>close</button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body p-4">
        <p className="text-xs uppercase text-base-content/50">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </div>
    </div>
  );
}
