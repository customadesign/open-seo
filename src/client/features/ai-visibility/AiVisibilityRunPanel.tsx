import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  estimateAiVisibilityRun,
  getAiVisibilityRunResults,
  getLatestAiVisibilityRun,
  triggerAiVisibilityRun,
} from "@/serverFunctions/ai-visibility";
import { AI_VISIBILITY_PROVIDER_LABELS } from "./aiVisibilityUi";

export type AiVisibilityRunEstimate = Awaited<
  ReturnType<typeof estimateAiVisibilityRun>
>;

export function AiVisibilityRunPanel({
  configId,
  projectId,
  readOnly,
  estimate,
  setEstimate,
}: {
  configId: string;
  projectId: string;
  readOnly: boolean;
  estimate: AiVisibilityRunEstimate | null;
  setEstimate: (value: AiVisibilityRunEstimate | null) => void;
}) {
  const queryClient = useQueryClient();
  const estimateMutation = useMutation({
    mutationFn: () =>
      estimateAiVisibilityRun({ data: { projectId, configId } }),
    onSuccess: setEstimate,
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not estimate run")),
  });
  const latestRunQuery = useQuery({
    queryKey: ["aiVisibilityLatestRun", projectId, configId],
    queryFn: () => getLatestAiVisibilityRun({ data: { projectId, configId } }),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ||
      query.state.data?.status === "running"
        ? 2_000
        : false,
  });
  const runMutation = useMutation({
    mutationFn: () =>
      triggerAiVisibilityRun({
        data: {
          projectId,
          configId,
          maxCostCredits: estimate!.costCredits,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("AI visibility run queued");
        setEstimate(null);
      } else {
        toast.info("An AI visibility run is already active");
      }
      void queryClient.invalidateQueries({
        queryKey: ["aiVisibilityLatestRun", projectId, configId],
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not start run")),
  });
  const latestRun = latestRunQuery.data;
  const resultsQuery = useQuery({
    queryKey: ["aiVisibilityRunResults", projectId, latestRun?.id],
    queryFn: () =>
      getAiVisibilityRunResults({
        data: { projectId, runId: latestRun!.id },
      }),
    enabled: Boolean(latestRun?.id),
    refetchInterval:
      latestRun?.status === "pending" || latestRun?.status === "running"
        ? 2_000
        : false,
  });

  return (
    <section className="card border border-base-300 bg-base-100">
      <div className="card-body gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Run and observations</h2>
            <p className="text-xs text-base-content/60">
              Status and observed outcome remain separate, so an unavailable
              provider is never counted as a missing brand mention.
            </p>
          </div>
          {!readOnly ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={estimateMutation.isPending || runMutation.isPending}
                onClick={() => estimateMutation.mutate()}
              >
                Review estimate
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm gap-1"
                disabled={
                  !estimate ||
                  estimate.observations === 0 ||
                  runMutation.isPending ||
                  latestRun?.status === "pending" ||
                  latestRun?.status === "running"
                }
                onClick={() => runMutation.mutate()}
              >
                <Play className="size-3.5" /> Run approved estimate
              </button>
            </div>
          ) : null}
        </div>

        {estimate ? (
          <div className="alert text-sm">
            <span>
              {estimate.promptCount} prompts × {estimate.providers.length}{" "}
              providers = {estimate.observations} observations, capped at{" "}
              <strong>{estimate.costCredits} credits</strong> (estimated raw
              provider cost ${estimate.costUsd.toFixed(4)}).
            </span>
          </div>
        ) : null}

        {latestRun ? (
          <p className="text-sm">
            Latest run: <strong>{latestRun.status}</strong> ·{" "}
            {latestRun.observationsCompleted}/{latestRun.observationsTotal}{" "}
            observations · ${latestRun.costUsd.toFixed(4)} actual provider cost
          </p>
        ) : (
          <p className="text-sm text-base-content/55">No runs yet.</p>
        )}

        {resultsQuery.data?.observations.length ? (
          <div className="overflow-x-auto rounded-lg border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Outcome</th>
                  <th>Mentions</th>
                  <th>Cited</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {resultsQuery.data.observations.map((observation) => (
                  <tr key={observation.id}>
                    <td className="max-w-xs whitespace-normal">
                      {observation.prompt}
                    </td>
                    <td>
                      {AI_VISIBILITY_PROVIDER_LABELS[observation.provider]}
                    </td>
                    <td>{observation.status}</td>
                    <td>{observation.outcome.replaceAll("_", " ")}</td>
                    <td>{observation.mentionCount}</td>
                    <td>
                      {observation.domainCited == null
                        ? "—"
                        : observation.domainCited
                          ? "Yes"
                          : "No"}
                    </td>
                    <td>{observation.modelName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
