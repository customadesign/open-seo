import { useQuery } from "@tanstack/react-query";
import { getCurrentWorkspaceAccess } from "@/serverFunctions/people";

export function useWorkspaceAccess() {
  return useQuery({
    queryKey: ["workspace-access"],
    queryFn: () => getCurrentWorkspaceAccess(),
    staleTime: 30_000,
  });
}
