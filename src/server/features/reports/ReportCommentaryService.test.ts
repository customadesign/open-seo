import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSnapshot } from "@/types/schemas/reports";
import { AppError } from "@/server/lib/errors";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getChatAgentModel: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  assertUsageCreditsAvailable: vi.fn(),
  trackUsageCreditSpend: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));
vi.mock("@/server/lib/openrouter", () => ({
  getChatAgentModel: mocks.getChatAgentModel,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));
vi.mock("@/server/billing/subscription", () => ({
  assertUsageCreditsAvailable: mocks.assertUsageCreditsAvailable,
  trackUsageCreditSpend: mocks.trackUsageCreditSpend,
}));

import { generateReportCommentary } from "./ReportCommentaryService";

const snapshot: ReportSnapshot = {
  version: 1,
  generatedAt: "2026-08-17T00:00:00.000Z",
  project: { id: "project-1", name: "Example", domain: "example.com" },
  period: { start: "2026-07-01", end: "2026-07-31" },
  comparisonPeriod: { start: "2026-06-01", end: "2026-06-30" },
  sections: [],
  omissions: [],
  evidence: [
    {
      key: "rankings.top10",
      label: "Top 10 rankings",
      value: "12, up from 10",
      direction: "positive",
    },
  ],
};

const context = {
  organizationId: "org-1",
  projectId: "project-1",
  runId: "run-1",
  trigger: "scheduled" as const,
};

const generatedItems = [
  { kind: "overview", text: "Overview", evidenceKey: "rankings.top10" },
  { kind: "win", text: "Win", evidenceKey: "rankings.top10" },
  { kind: "watch", text: "Watch", evidenceKey: null },
  { kind: "next_step", text: "Next", evidenceKey: null },
];

describe("generateReportCommentary", () => {
  beforeEach(() => {
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.assertUsageCreditsAvailable.mockResolvedValue({
      monthlyRemaining: 750,
    });
    mocks.getChatAgentModel.mockResolvedValue({});
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({ items: generatedItems }),
      providerMetadata: { openrouter: { usage: { cost: 0.0123 } } },
    });
    mocks.trackUsageCreditSpend.mockResolvedValue(undefined);
  });

  it("uses deterministic commentary without calling OpenRouter when hosted credits are depleted", async () => {
    mocks.assertUsageCreditsAvailable.mockRejectedValue(
      new AppError("INSUFFICIENT_CREDITS"),
    );

    const result = await generateReportCommentary(snapshot, context);

    expect(result.map((item) => item.kind)).toEqual([
      "overview",
      "win",
      "watch",
      "next_step",
    ]);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.trackUsageCreditSpend).not.toHaveBeenCalled();
  });

  it("meters the actual hosted OpenRouter cost with report metadata", async () => {
    const result = await generateReportCommentary(snapshot, context);

    expect(result).toHaveLength(4);
    expect(mocks.trackUsageCreditSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org-1",
        creditFeature: "reports",
        costUsd: 0.0123,
        monthlyRemaining: 750,
        properties: {
          provider: "openrouter",
          report_run_id: "run-1",
          trigger: "scheduled",
        },
      }),
    );
  });

  it("uses deterministic commentary for self-hosted scheduled runs without provider spend", async () => {
    mocks.isHostedServerAuthMode.mockResolvedValue(false);

    const result = await generateReportCommentary(snapshot, context);

    expect(result).toHaveLength(4);
    expect(mocks.assertUsageCreditsAvailable).not.toHaveBeenCalled();
    expect(mocks.trackUsageCreditSpend).not.toHaveBeenCalled();
    expect(mocks.getChatAgentModel).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("allows an explicit manual self-hosted report to use the configured provider", async () => {
    mocks.isHostedServerAuthMode.mockResolvedValue(false);

    const result = await generateReportCommentary(snapshot, {
      ...context,
      trigger: "manual",
    });

    expect(result).toHaveLength(4);
    expect(mocks.assertUsageCreditsAvailable).not.toHaveBeenCalled();
    expect(mocks.trackUsageCreditSpend).not.toHaveBeenCalled();
    expect(mocks.generateText).toHaveBeenCalledOnce();
  });

  it("surfaces metering failures instead of silently granting untracked spend", async () => {
    mocks.trackUsageCreditSpend.mockRejectedValue(
      new Error("billing unavailable"),
    );

    await expect(generateReportCommentary(snapshot, context)).rejects.toThrow(
      "billing unavailable",
    );
  });

  it("meters malformed provider output before using deterministic commentary", async () => {
    mocks.generateText.mockResolvedValue({
      text: "not valid JSON",
      providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
    });

    const result = await generateReportCommentary(snapshot, context);

    expect(result.map((item) => item.kind)).toEqual([
      "overview",
      "win",
      "watch",
      "next_step",
    ]);
    expect(mocks.trackUsageCreditSpend).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.0042 }),
    );
  });

  it("accepts valid JSON wrapped in a Markdown fence", async () => {
    mocks.generateText.mockResolvedValue({
      text: `\`\`\`json\n${JSON.stringify({ items: generatedItems })}\n\`\`\``,
      providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
    });

    const result = await generateReportCommentary(snapshot, context);

    expect(result.map((item) => item.text)).toEqual([
      "Overview",
      "Win",
      "Watch",
      "Next",
    ]);
  });
});
