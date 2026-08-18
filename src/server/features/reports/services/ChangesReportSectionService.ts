import {
  CHANGE_EVENT_REPORT_LIMIT,
  ChangeEventRepository,
} from "@/server/features/change-events/repositories/ChangeEventRepository";
import type { ReportSectionLoadResult } from "../ReportSnapshotAssembler";
import { toChangesSectionResult } from "./ChangesReportSection";

async function load(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ReportSectionLoadResult> {
  const [events, groups] = await Promise.all([
    ChangeEventRepository.listForReportPeriod({
      ...input,
      limit: CHANGE_EVENT_REPORT_LIMIT,
    }),
    ChangeEventRepository.summarizeForReportPeriod(input),
  ]);
  return toChangesSectionResult(events, groups);
}

export const ChangesReportSectionService = { load } as const;
