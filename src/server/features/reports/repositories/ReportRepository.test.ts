import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertedValues: null as Record<string, unknown> | null,
  runBatch: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { insert: mocks.insert } }));
vi.mock("@/db/runBatch", () => ({ runBatch: mocks.runBatch }));

import { ReportRepository } from "./ReportRepository";

describe("ReportRepository", () => {
  beforeEach(() => {
    mocks.insertedValues = null;
    mocks.runBatch.mockResolvedValue(undefined);
    mocks.insert.mockImplementation(() => {
      const builder = {
        values: vi.fn(),
        onConflictDoNothing: vi.fn(),
        returning: vi.fn().mockResolvedValue([
          {
            id: "settings-1",
            projectId: "project-1",
            organizationId: "org-1",
            isEnabled: false,
          },
        ]),
      };
      builder.values.mockImplementation((values: Record<string, unknown>) => {
        mocks.insertedValues = values;
        return builder;
      });
      builder.onConflictDoNothing.mockReturnValue(builder);
      return builder;
    });
  });

  it("creates report settings disabled until an owner explicitly enables them", async () => {
    await ReportRepository.createDefaultSettings({
      projectId: "project-1",
      organizationId: "org-1",
      timeZone: "UTC",
      nextRunAt: "2026-09-04T09:00:00.000Z",
    });

    expect(mocks.insertedValues).toMatchObject({
      projectId: "project-1",
      organizationId: "org-1",
      isEnabled: false,
    });
  });
});
