import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";

vi.mock("cloudflare:workers", () => ({
  env: {},
}));

const mocks = vi.hoisted(() => ({
  findReadyRun: vi.fn(),
  getRunById: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  fetchLabsMagicRows: vi.fn(),
  insertRun: vi.fn(),
  replaceRunContents: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));

vi.mock("../../repositories/KeywordMagicRepository", () => ({
  KeywordMagicRepository: {
    findReadyRun: mocks.findReadyRun,
    getRunById: mocks.getRunById,
    insertRun: mocks.insertRun,
    replaceRunContents: mocks.replaceRunContents,
    listHistory: vi.fn(),
    listKeywordsPage: vi.fn(),
    listClusters: vi.fn(),
    listSerpFeaturesByKeywordIds: vi.fn(),
    listKeywordsByValues: vi.fn(),
    listKeywordsForExport: vi.fn(),
    updateKeywordMetrics: vi.fn(),
  },
}));

vi.mock("./fetch-magic", () => ({
  fetchLabsMagicRows: mocks.fetchLabsMagicRows,
  fetchAdsMagicRows: vi.fn(),
}));

import type { BillingCustomerContext } from "@/server/billing/subscription";
import { estimateKeywordMagic, runKeywordMagic } from "./KeywordMagicService";

const billing: BillingCustomerContext = {
  organizationId: "org_1",
  userId: "user_1",
  userEmail: "alice@example.com",
};

describe("KeywordMagicService", () => {
  beforeEach(() => {
    mocks.findReadyRun.mockResolvedValue(null);
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
  });

  it("returns a free cached estimate when a fresh run exists", async () => {
    mocks.findReadyRun.mockResolvedValue({
      id: "run_1",
      status: "ready",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const estimate = await estimateKeywordMagic(
      {
        projectId: "project_1",
        seed: "crm software",
        locationCode: 2840,
        languageCode: "en",
      },
      billing,
    );

    expect(estimate).toMatchObject({
      cached: true,
      runId: "run_1",
      costCredits: 0,
    });
    expect(mocks.fetchLabsMagicRows).not.toHaveBeenCalled();
  });

  it("refuses a billed run without an approved credit ceiling", async () => {
    await expect(
      runKeywordMagic(
        {
          projectId: "project_1",
          seed: "crm software",
          locationCode: 2840,
          languageCode: "en",
          maxKeywords: 1000,
        },
        billing,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(mocks.fetchLabsMagicRows).not.toHaveBeenCalled();
  });
});
