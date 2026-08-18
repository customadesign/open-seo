export type CompetitorSerpRow = {
  trackingKeywordId: string;
  domain: string;
  position: number | null;
  runId?: string;
};

export type CompetitorDiscoveryRow = {
  domain: string;
  overlapCount: number;
  appearanceCount: number;
  averagePosition: number;
};

/**
 * Rank competitor domains by keyword overlap, then how many retained checks
 * they appear in, then average best organic position.
 */
export function discoverCompetitors(
  rows: readonly CompetitorSerpRow[],
): CompetitorDiscoveryRow[] {
  const byDomain = new Map<
    string,
    { keywords: Map<string, number>; runs: Set<string> }
  >();
  for (const row of rows) {
    if (row.domain.length === 0 || row.position == null || row.position < 1) {
      continue;
    }
    const existing = byDomain.get(row.domain) ?? {
      keywords: new Map<string, number>(),
      runs: new Set<string>(),
    };
    const best = existing.keywords.get(row.trackingKeywordId);
    if (best == null || row.position < best) {
      existing.keywords.set(row.trackingKeywordId, row.position);
    }
    existing.runs.add(row.runId ?? "__check");
    byDomain.set(row.domain, existing);
  }

  return [...byDomain.entries()]
    .map(([domain, { keywords, runs }]) => {
      const positions = [...keywords.values()];
      return {
        domain,
        overlapCount: keywords.size,
        appearanceCount: runs.size,
        averagePosition:
          positions.reduce((sum, value) => sum + value, 0) / positions.length,
      };
    })
    .toSorted((a, b) => {
      if (b.overlapCount !== a.overlapCount) {
        return b.overlapCount - a.overlapCount;
      }
      if (b.appearanceCount !== a.appearanceCount) {
        return b.appearanceCount - a.appearanceCount;
      }
      if (a.averagePosition !== b.averagePosition) {
        return a.averagePosition - b.averagePosition;
      }
      return a.domain.localeCompare(b.domain);
    });
}
