import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDomainBrandToken,
  getDomainBrandTokens,
  getDomainCompare,
  getDomainCompetitors,
  getDomainHistoricalOverview,
  getDomainKeywordsByIntent,
  getDomainPagesExtras,
  getDomainPositionChanges,
  getDomainSerpFeatures,
  getDomainSubdomains,
  getDomainTrafficBreakdown,
  removeDomainBrandToken,
} from "@/serverFunctions/domain";

type DomainReportInput = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number | undefined;
};

function reportKey(name: string, input: DomainReportInput) {
  return [
    name,
    input.projectId,
    input.domain,
    input.includeSubdomains,
    input.locationCode,
  ] as const;
}

function enabled(input: DomainReportInput) {
  return input.domain.trim() !== "";
}

function reportData(input: DomainReportInput) {
  return {
    projectId: input.projectId,
    domain: input.domain,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
  };
}

const staleTime = 5 * 60_000;

export function useDomainPositionChangesQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-position-changes", input),
    queryFn: () => getDomainPositionChanges({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainIntentQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-intent", input),
    queryFn: () => getDomainKeywordsByIntent({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainSerpFeaturesQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-serp-features", input),
    queryFn: () => getDomainSerpFeatures({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainTrafficBreakdownQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-traffic-breakdown", input),
    queryFn: () => getDomainTrafficBreakdown({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainCompetitorsQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-competitors", input),
    queryFn: () => getDomainCompetitors({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainSubdomainsQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-subdomains", input),
    queryFn: () => getDomainSubdomains({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainHistoricalOverviewQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-historical-overview", input),
    queryFn: () => getDomainHistoricalOverview({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainPagesExtrasQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-pages-extras", input),
    queryFn: () => getDomainPagesExtras({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainCompareQuery(
  input: DomainReportInput & { domains: string[] },
) {
  return useQuery({
    enabled: enabled(input) && input.domains.length > 0,
    queryKey: [...reportKey("domain-compare", input), input.domains],
    queryFn: () =>
      getDomainCompare({
        data: { ...reportData(input), domains: input.domains },
      }),
    staleTime,
  });
}

export function useDomainBrandTokensQuery(input: DomainReportInput) {
  return useQuery({
    enabled: enabled(input),
    queryKey: reportKey("domain-brand-tokens", input),
    queryFn: () => getDomainBrandTokens({ data: reportData(input) }),
    staleTime,
  });
}

export function useDomainBrandTokenMutations(input: DomainReportInput) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: reportKey("domain-brand-tokens", input),
    });
    void queryClient.invalidateQueries({
      queryKey: reportKey("domain-traffic-breakdown", input),
    });
  };

  const add = useMutation({
    mutationFn: (token: string) =>
      addDomainBrandToken({ data: { ...reportData(input), token } }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (token: string) =>
      removeDomainBrandToken({ data: { ...reportData(input), token } }),
    onSuccess: invalidate,
  });

  return { add, remove };
}
