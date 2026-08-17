import { describe, expect, it } from "vitest";
import { REPORT_SECTION_KEYS, mergeReportSections } from "./report-sections";

describe("mergeReportSections", () => {
  it("adds a newly shipped section disabled so an existing report is unchanged", () => {
    const stored = [
      { key: "rankings", enabled: true },
      { key: "gsc", enabled: false },
    ];

    const merged = mergeReportSections(stored);

    expect(merged).toHaveLength(REPORT_SECTION_KEYS.length);
    expect(merged.slice(0, 2)).toEqual(stored);
    expect(merged.slice(2).filter((section) => section.enabled)).toEqual([]);
  });

  it("drops a key this build cannot render rather than offering a dead toggle", () => {
    const merged = mergeReportSections([
      { key: "from_a_newer_deploy", enabled: true },
    ]);

    expect(merged.map((section) => section.key)).toEqual([
      ...REPORT_SECTION_KEYS,
    ]);
    expect(merged.every((section) => !section.enabled)).toBe(true);
  });
});
