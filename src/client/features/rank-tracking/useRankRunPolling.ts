import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getLatestRankRun } from "@/serverFunctions/rank-tracking";

/**
 * Polls the latest rank check run for a config, auto-refreshing every
 * run-derived query when a run finishes.
 */
export function useRankRunPolling(projectId: string, configId: string) {
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<string | undefined>(undefined);

  const { data: latestRun } = useQuery({
    queryKey: ["rankTrackingLatestRun", projectId, configId],
    queryFn: () => getLatestRankRun({ data: { projectId, configId } }),
    refetchInterval: (query) => {
      const run = query.state.data;
      const prev = prevStatusRef.current;
      prevStatusRef.current = run?.status;

      // When a run transitions to a terminal state, refresh everything built
      // from this config's runs — results, trend chart, history matrix, report
      // tabs and the check log all key as [name, projectId, configId, ...].
      const isTerminal =
        run?.status === "completed" || run?.status === "failed";
      const wasActive = prev === "running" || prev === "pending";
      if (wasActive && isTerminal) {
        void queryClient.invalidateQueries({
          predicate: ({ queryKey }) =>
            queryKey[0] !== "rankTrackingLatestRun" &&
            queryKey[1] === projectId &&
            queryKey[2] === configId,
        });
      }

      // Keep polling active runs, including stale ones (they'll be cleaned up
      // by the cron handler and we want to show the transition).
      if (run?.status === "pending" || run?.status === "running") return 3000;
      return false;
    },
  });

  return latestRun;
}
