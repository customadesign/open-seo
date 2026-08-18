import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { audits } from "@/db/schema";

async function getPreviousCompletedAudit(input: {
  projectId: string;
  startUrl: string;
  beforeStartedAt: string;
}) {
  return db.query.audits.findFirst({
    where: and(
      eq(audits.projectId, input.projectId),
      eq(audits.startUrl, input.startUrl),
      eq(audits.status, "completed"),
      lt(audits.startedAt, input.beforeStartedAt),
    ),
    orderBy: desc(audits.startedAt),
  });
}

export const AuditComparisonRepository = {
  getPreviousCompletedAudit,
} as const;
