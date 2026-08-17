import { describe, expect, it } from "vitest";
import { auditSchedules as sqliteAuditSchedules } from "./audit.schema";
import { auditSchedules as pgAuditSchedules } from "./pg/audit.schema";

// A schedule row nobody has configured must be inert in BOTH dialects: this is
// what keeps a migrated or imported project from crawling on its own. The
// parity test proves the two schemas match structurally but not what they
// default to, so the "recurring audits are opt-in" rule is asserted here.
describe("audit_schedules defaults", () => {
  it.each([
    ["sqlite", sqliteAuditSchedules],
    ["postgres", pgAuditSchedules],
  ])("is paused and manual by default (%s)", (_dialect, table) => {
    expect(table.isActive.default).toBe(false);
    expect(table.scheduleInterval.default).toBe("manual");
    // No anchor means the due query can never select the row.
    expect(table.nextRunAt.hasDefault).toBe(false);
  });
});
