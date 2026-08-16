import { describe, expect, it } from "vitest";
import { getProjectNavGroups } from "./items";

function projectPaths(canUseProjectTools: boolean) {
  return getProjectNavGroups("project-1", { canUseProjectTools }).flatMap(
    (group) => group.items.map((item) => item.to),
  );
}

describe("project navigation", () => {
  it.each([
    ["staff", true],
    ["client", false],
  ] as const)(
    "keeps Local SEO and Reports visible to %s users",
    (_, canUseProjectTools) => {
      const paths = projectPaths(canUseProjectTools);

      expect(paths).toContain("/p/$projectId/local-seo");
      expect(paths).toContain("/p/$projectId/reports");
    },
  );
});
