import type { ReportSectionLoadResult } from "../ReportSnapshotAssembler";

type ReportChangeEvent = {
  occurredAt: string;
  source: string;
  eventType: string;
  severity: string;
  title: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  metricKey: string | null;
  previousNumericValue: number | null;
  currentNumericValue: number | null;
  unit: string | null;
};

type ReportChangeGroup = {
  source: string;
  severity: string;
  total: number;
};

function countRows(
  groups: ReportChangeGroup[],
  key: "source" | "severity",
): Array<{ key: string; count: number }> {
  const totals = new Map<string, number>();
  for (const group of groups) {
    const value = group[key];
    totals.set(value, (totals.get(value) ?? 0) + Number(group.total));
  }
  return [...totals.entries()]
    .map(([name, count]) => ({ key: name, count }))
    .toSorted((a, b) => a.key.localeCompare(b.key));
}

export function toChangesSectionResult(
  events: ReportChangeEvent[],
  groups: ReportChangeGroup[],
): ReportSectionLoadResult {
  const total = groups.reduce((sum, group) => sum + Number(group.total), 0);
  if (total === 0) return { status: "no_data" };

  return {
    status: "available",
    data: {
      total,
      shown: events.length,
      omitted: Math.max(0, total - events.length),
      bySeverity: countRows(groups, "severity").map(({ key, count }) => ({
        severity: key,
        count,
      })),
      bySource: countRows(groups, "source").map(({ key, count }) => ({
        source: key,
        count,
      })),
      events: events.map((event) => ({
        occurredAt: event.occurredAt,
        source: event.source,
        eventType: event.eventType,
        severity: event.severity,
        title: event.title,
        summary: event.summary,
        entityType: event.entityType,
        entityId: event.entityId,
        metricKey: event.metricKey,
        previousNumericValue: event.previousNumericValue,
        currentNumericValue: event.currentNumericValue,
        unit: event.unit,
      })),
    },
  };
}
