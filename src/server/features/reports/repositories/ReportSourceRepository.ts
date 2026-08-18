import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { citationAuditRuns, geoGridConfigs, geoGridRuns } from "@/db/schema";

async function getLocalSummary(projectId: string) {
  const [gridRows, citationRows] = await Promise.all([
    db
      .select({ run: geoGridRuns, config: geoGridConfigs })
      .from(geoGridRuns)
      .innerJoin(geoGridConfigs, eq(geoGridRuns.configId, geoGridConfigs.id))
      .where(
        and(
          eq(geoGridRuns.projectId, projectId),
          eq(geoGridConfigs.projectId, projectId),
        ),
      )
      .orderBy(desc(geoGridRuns.startedAt), desc(geoGridRuns.id))
      .limit(50),
    db
      .select()
      .from(citationAuditRuns)
      .where(eq(citationAuditRuns.projectId, projectId))
      .orderBy(desc(citationAuditRuns.startedAt), desc(citationAuditRuns.id))
      .limit(1),
  ]);

  const latestByConfig = new Map<string, (typeof gridRows)[number]>();
  for (const row of gridRows) {
    if (!latestByConfig.has(row.config.id))
      latestByConfig.set(row.config.id, row);
  }

  return {
    gridRuns: [...latestByConfig.values()]
      .map(({ run, config }) => ({
        configId: config.id,
        keyword: config.keyword,
        status: run.status,
        averageRank: run.averageRank,
        topThreeCoverage: run.topThreeCoverage,
        topTenCoverage: run.topTenCoverage,
        topTwentyCoverage: run.topTwentyCoverage,
        cellsCompleted: run.cellsCompleted,
        cellsTotal: run.cellsTotal,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }))
      .toSorted((a, b) => a.configId.localeCompare(b.configId)),
    citationAudit: citationRows[0]
      ? {
          status: citationRows[0].status,
          observationsTotal: citationRows[0].observationsTotal,
          confirmedMatches: citationRows[0].confirmedMatches,
          confirmedMismatches: citationRows[0].confirmedMismatches,
          foundUnverified: citationRows[0].foundUnverified,
          notFound: citationRows[0].notFound,
          blocked: citationRows[0].blocked,
          startedAt: citationRows[0].startedAt,
          completedAt: citationRows[0].completedAt,
        }
      : null,
  };
}

export const ReportSourceRepository = { getLocalSummary } as const;
