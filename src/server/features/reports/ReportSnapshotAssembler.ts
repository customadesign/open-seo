import { reportSnapshotSchema } from "@/types/schemas/reports";
import type {
  ReportSectionKey,
  ReportSnapshot,
  ResolvedReportBranding,
} from "@/types/schemas/reports";

export type ReportSectionLoadResult =
  | { status: "available"; data: unknown }
  | { status: "not_configured" | "no_data" };

export type ReportSectionDataSource = {
  load(
    key: ReportSectionKey,
    input: {
      projectId: string;
      periodStart: string;
      periodEnd: string;
      generatedAt: string;
    },
  ): Promise<ReportSectionLoadResult>;
};

type SnapshotInput = {
  generatedAt: string;
  project: { id: string; name: string; domain: string | null };
  periodStart: string;
  periodEnd: string;
  branding: ResolvedReportBranding;
  sections: Array<{ key: ReportSectionKey; enabled: boolean }>;
};

export async function assembleReportSnapshot(
  input: SnapshotInput,
  source: ReportSectionDataSource,
): Promise<ReportSnapshot> {
  const enabled = input.sections.filter((section) => section.enabled);
  const results = await Promise.all(
    enabled.map(async (section) => {
      try {
        return {
          key: section.key,
          result: await source.load(section.key, {
            projectId: input.project.id,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            generatedAt: input.generatedAt,
          }),
        };
      } catch {
        return {
          key: section.key,
          result: { status: "source_error" as const },
        };
      }
    }),
  );

  return reportSnapshotSchema.parse({
    version: 1,
    generatedAt: input.generatedAt,
    project: input.project,
    period: { start: input.periodStart, end: input.periodEnd },
    branding: input.branding,
    sections: results.flatMap(({ key, result }) =>
      result.status === "available" ? [{ key, data: result.data }] : [],
    ),
    omissions: results.flatMap(({ key, result }) =>
      result.status === "available" ? [] : [{ key, reason: result.status }],
    ),
  });
}

function normalizeJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return null;
}

/** Canonical JSON keeps artifacts, hashes, and retries byte-for-byte stable. */
export function stableReportSnapshotJson(snapshot: ReportSnapshot): string {
  return JSON.stringify(normalizeJson(reportSnapshotSchema.parse(snapshot)));
}
