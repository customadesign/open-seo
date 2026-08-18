export type CompetitorSerpRow = {
  trackingKeywordId: string;
  domain: string;
  position: number | null;
};

export type CompetitorDiscoveryRow = {
  domain: string;
  overlapCount: number;
  averagePosition: number;
};

/**
 * Rank competitor domains by how many tracked keywords they appear on, then
 * by average best organic position. Each keyword contributes its best stored
 * position for that domain.
 */
export function discoverCompetitors(
  rows: readonly CompetitorSerpRow[],
): CompetitorDiscoveryRow[] {
  const byDomain = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.domain.length === 0 || row.position == null || row.position < 1) {
      continue;
    }
    const keywords = byDomain.get(row.domain) ?? new Map<string, number>();
    const existing = keywords.get(row.trackingKeywordId);
    if (existing == null || row.position < existing) {
      keywords.set(row.trackingKeywordId, row.position);
    }
    byDomain.set(row.domain, keywords);
  }

  return [...byDomain.entries()]
    .map(([domain, keywords]) => {
      const positions = [...keywords.values()];
      return {
        domain,
        overlapCount: keywords.size,
        averagePosition:
          positions.reduce((sum, value) => sum + value, 0) / positions.length,
      };
    })
    .toSorted((a, b) => {
      if (b.overlapCount !== a.overlapCount) {
        return b.overlapCount - a.overlapCount;
      }
      if (a.averagePosition !== b.averagePosition) {
        return a.averagePosition - b.averagePosition;
      }
      return a.domain.localeCompare(b.domain);
    });
}
