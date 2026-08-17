import { describe, expect, it } from "vitest";
import {
  formatPreflightReport,
  legacyRowCountQuery,
  legacyRowCountQuerySqlite,
} from "./report-delivery-preflight";

describe("report delivery preflight", () => {
  it("refuses to inspect a table outside the legacy set", () => {
    expect(() => legacyRowCountQuery("projects; DROP TABLE users")).toThrow(
      /unknown table/u,
    );
  });

  it("counts orphans only for project-scoped legacy tables", () => {
    expect(legacyRowCountQuerySqlite("report_runs")).toContain(
      "FROM projects WHERE projects.id = report_runs.project_id",
    );
    expect(legacyRowCountQuerySqlite("report_deliveries")).toContain(
      "0 AS orphaned",
    );
  });

  it("calls out orphaned rows in the summary", () => {
    const report = formatPreflightReport({
      provider: "postgres",
      migrations: ["abc123  1750000000"],
      legacyTables: [{ table: "report_runs", total: 12, orphaned: 3 }],
    });
    expect(report).toContain("report_runs: 12 row(s), 3 orphaned");
    expect(report).toContain("Resolve 3 orphaned legacy row(s)");
  });
});
