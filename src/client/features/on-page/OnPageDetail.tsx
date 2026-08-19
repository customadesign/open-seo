import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getOnPagePage,
  removeOnPageKeyword,
  removeOnPageTarget,
} from "@/serverFunctions/on-page";
import {
  ON_PAGE_BUCKET_LABELS,
  ON_PAGE_PRIORITY_LABELS,
  isOnPagePriority,
} from "@/shared/on-page";

export function OnPageDetail({
  projectId,
  pageId,
}: {
  projectId: string;
  pageId: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accessQuery = useWorkspaceAccess();
  const readOnly = accessQuery.data?.role === "client";

  const detailQuery = useQuery({
    queryKey: ["onPagePage", projectId, pageId],
    queryFn: () => getOnPagePage({ data: { projectId, pageId } }),
  });
  const detail = detailQuery.data;

  const removePage = useMutation({
    mutationFn: () => removeOnPageTarget({ data: { projectId, pageId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["onPageOverview", projectId],
      });
      void navigate({
        to: "/p/$projectId/on-page",
        params: { projectId },
        search: {},
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const removeKeyword = useMutation({
    mutationFn: (keywordId: string) =>
      removeOnPageKeyword({ data: { projectId, keywordId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["onPagePage", projectId, pageId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void navigate({
              to: "/p/$projectId/on-page",
              params: { projectId },
              search: {},
            })
          }
        >
          All pages
        </button>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold break-all">
              {detail?.page.url ?? "On-page ideas"}
            </h1>
            <p className="mt-1 text-sm text-base-content/70">
              {detail?.keywords.map((keyword) => keyword.keyword).join(", ") ||
                "No target keywords"}
            </p>
          </div>
          {!readOnly ? (
            <button
              className="btn btn-ghost btn-sm text-error"
              onClick={() => removePage.mutate()}
              disabled={removePage.isPending}
            >
              Remove page
            </button>
          ) : null}
        </header>

        {detail && !detail.audit ? (
          <div className="alert alert-warning text-sm">
            <AlertTriangle className="size-4" />
            <span>
              No completed site audit, so technical ideas cannot be mapped for
              this page.
            </span>
          </div>
        ) : null}

        {detail && detail.keywords.length > 0 && !readOnly ? (
          <div className="flex flex-wrap gap-2">
            {detail.keywords.map((keyword) => (
              <button
                key={keyword.id}
                className="badge badge-outline gap-1"
                onClick={() => removeKeyword.mutate(keyword.id)}
              >
                {keyword.keyword}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}

        <ul className="space-y-3">
          {detailQuery.isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : detail?.ideas.length ? (
            detail.ideas.map((idea) => (
              <li
                key={idea.id}
                className="card border border-base-300 bg-base-100"
              >
                <div className="card-body gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-ghost">
                      {ON_PAGE_BUCKET_LABELS[idea.bucket]}
                    </span>
                    <span className="badge">
                      {isOnPagePriority(idea.priority)
                        ? ON_PAGE_PRIORITY_LABELS[idea.priority]
                        : idea.priority}
                    </span>
                    {idea.resolvedAt ? (
                      <span className="badge badge-outline">Resolved</span>
                    ) : null}
                  </div>
                  <h2 className="font-medium">{idea.title}</h2>
                  <p className="text-sm text-base-content/70">{idea.summary}</p>
                  {idea.keyword ? (
                    <p className="text-xs text-base-content/50">
                      Keyword: {idea.keyword}
                    </p>
                  ) : null}
                  <pre className="overflow-x-auto rounded-lg bg-base-200 p-3 text-xs">
                    {JSON.stringify(idea.evidence, null, 2)}
                  </pre>
                </div>
              </li>
            ))
          ) : (
            <p className="text-sm text-base-content/60">
              No ideas stored for this page yet. Run the checker from the
              project view.
            </p>
          )}
        </ul>
      </div>
    </div>
  );
}
