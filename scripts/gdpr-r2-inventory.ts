import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
// The Node-safe raw barrel (not ../src/db/schema, the provider-aware one,
// which imports cloudflare:workers).
import * as schema from "../src/db/pg/schema";

type R2InventoryDb = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Every column that points at an R2 object owned by a project.
 *
 * R2 has no foreign keys: once the erasure transaction cascades these rows away
 * with the organization, nothing left in Postgres can name the objects they
 * referenced, so they would sit in the bucket forever. Each pointer is therefore
 * collected *before* the delete runs. gdpr-r2-inventory.test.ts fails when the
 * schema grows a pointer this list does not cover.
 */
export const R2_KEY_COLUMNS = [
  { table: "audit_lighthouse_results", column: "r2_key" },
  { table: "ai_visibility_observations", column: "evidence_r2_key" },
  { table: "monthly_report_artifacts", column: "storage_key" },
] as const;

/** One query per entry in R2_KEY_COLUMNS, in the same order. */
export function projectR2KeyQueries(db: R2InventoryDb, projectIds: string[]) {
  return [
    db
      .selectDistinct({ key: schema.auditLighthouseResults.r2Key })
      .from(schema.auditLighthouseResults)
      .innerJoin(
        schema.audits,
        eq(schema.audits.id, schema.auditLighthouseResults.auditId),
      )
      .where(
        and(
          inArray(schema.audits.projectId, projectIds),
          isNotNull(schema.auditLighthouseResults.r2Key),
        ),
      ),
    db
      .selectDistinct({ key: schema.aiVisibilityObservations.evidenceR2Key })
      .from(schema.aiVisibilityObservations)
      .innerJoin(
        schema.aiVisibilityRuns,
        eq(schema.aiVisibilityRuns.id, schema.aiVisibilityObservations.runId),
      )
      .where(
        and(
          inArray(schema.aiVisibilityRuns.projectId, projectIds),
          isNotNull(schema.aiVisibilityObservations.evidenceR2Key),
        ),
      ),
    db
      .selectDistinct({ key: schema.reportArtifacts.storageKey })
      .from(schema.reportArtifacts)
      .innerJoin(
        schema.reportRuns,
        eq(schema.reportRuns.id, schema.reportArtifacts.runId),
      )
      .where(inArray(schema.reportRuns.projectId, projectIds)),
  ];
}

export async function collectProjectR2Keys(
  db: R2InventoryDb,
  projectIds: string[],
): Promise<string[]> {
  // drizzle's inArray throws on an empty array.
  if (projectIds.length === 0) return [];
  const results = await Promise.all(projectR2KeyQueries(db, projectIds));
  const keys = new Set(
    results.flat().flatMap((row) => (row.key ? [row.key] : [])),
  );
  return [...keys].sort();
}
