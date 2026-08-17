import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityService } from "./AiVisibilityService";
import {
  estimateAiVisibilityRunCredits,
  MAX_PROMPTS_PER_CONFIG,
} from "@/shared/ai-visibility";

const mocks = vi.hoisted(() => ({
  getConfigById: vi.fn(),
  getConfigByBrand: vi.fn(),
  getConfigsForProject: vi.fn(),
  getProvidersForConfig: vi.fn(),
  getPromptsForConfig: vi.fn(),
  getActivePromptsForConfig: vi.fn(),
  addPrompts: vi.fn(),
  removePrompts: vi.fn(),
  getPromptCountForConfig: vi.fn(),
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
  setProvidersForConfig: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  customerHasPaidPlan: vi.fn(),
  beginAiVisibilityRun: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { AI_VISIBILITY_WORKFLOW: {} } }));
vi.mock(
  "@/server/features/ai-visibility/repositories/AiVisibilityRepository",
  () => ({ AiVisibilityRepository: mocks }),
);
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));
vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
}));
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityRunGuards",
  () => ({
    beginAiVisibilityRun: mocks.beginAiVisibilityRun,
    reconcileActiveAiVisibilityRun: vi.fn(),
  }),
);

const config = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "project_1",
  brandName: "OpenSEO",
  domain: "openseo.so",
  locationCode: 2840,
  languageCode: "en",
  scheduleInterval: "manual" as const,
  isActive: false,
  maxCostCredits: null as number | null,
};

const billingCustomer = {
  userId: "user_1",
  userEmail: "user@example.com",
  organizationId: "org_1",
  projectId: "project_1",
};

function promptRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `prompt_${index}`,
    prompt: `prompt ${index}`,
  }));
}

describe("AiVisibilityService", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue(config);
    mocks.getConfigByBrand.mockResolvedValue(null);
    mocks.isHostedServerAuthMode.mockResolvedValue(false);
    mocks.beginAiVisibilityRun.mockResolvedValue({ ok: true, runId: "run_1" });
    mocks.getProvidersForConfig.mockResolvedValue(["gemini"]);
    mocks.getPromptsForConfig.mockResolvedValue([]);
    mocks.getActivePromptsForConfig.mockResolvedValue(promptRows(2));
  });

  it("rejects prompts that would push a config past the cap", async () => {
    mocks.getPromptsForConfig.mockResolvedValue(
      promptRows(MAX_PROMPTS_PER_CONFIG - 1),
    );

    await expect(
      AiVisibilityService.addPrompts({
        configId: config.id,
        projectId: config.projectId,
        prompts: ["brand new one", "brand new two"],
      }),
    ).rejects.toThrow(/at most 50 prompts/i);
    expect(mocks.addPrompts).not.toHaveBeenCalled();
  });

  it("counts only genuinely new prompts against the cap", async () => {
    // Re-submitting existing prompts (or duplicates within one request) must
    // not consume cap headroom that nothing will occupy.
    mocks.getPromptsForConfig.mockResolvedValue([
      { id: "prompt_0", prompt: "existing" },
    ]);

    await expect(
      AiVisibilityService.addPrompts({
        configId: config.id,
        projectId: config.projectId,
        prompts: ["existing", "fresh", "fresh"],
      }),
    ).resolves.toEqual({ added: 1, total: 2 });
  });

  it("refuses a run whose estimate exceeds the approved ceiling", async () => {
    const { costCredits } = estimateAiVisibilityRunCredits({
      promptCount: 2,
      providers: ["gemini"],
    });

    await expect(
      AiVisibilityService.triggerRun({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer,
        maxCostCredits: costCredits - 1,
      }),
    ).rejects.toThrow(/above the approved maximum/i);
    expect(mocks.beginAiVisibilityRun).not.toHaveBeenCalled();
  });

  it("enforces the stricter of the caller's and the config's ceiling", async () => {
    const { costCredits } = estimateAiVisibilityRunCredits({
      promptCount: 2,
      providers: ["gemini"],
    });
    // Caller approves plenty; the config's standing ceiling is the binding one.
    mocks.getConfigById.mockResolvedValue({
      ...config,
      maxCostCredits: costCredits - 1,
    });

    await expect(
      AiVisibilityService.triggerRun({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer,
        maxCostCredits: costCredits + 1000,
      }),
    ).rejects.toThrow(/above the approved maximum/i);
  });

  it("refuses to run a config with no providers enabled", async () => {
    // The default state of a new config — it must cost nothing to own.
    mocks.getProvidersForConfig.mockResolvedValue([]);

    await expect(
      AiVisibilityService.triggerRun({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer,
        maxCostCredits: 1,
      }),
    ).rejects.toThrow(/at least one AI provider/i);
    expect(mocks.beginAiVisibilityRun).not.toHaveBeenCalled();
  });

  it("creates configs inactive and unscheduled unless asked otherwise", async () => {
    mocks.getConfigsForProject.mockResolvedValue([]);

    await AiVisibilityService.createConfig({
      projectId: "project_1",
      projectMarket: { locationCode: 2840, languageCode: "en" },
      brandName: "OpenSEO",
      domain: "https://www.openseo.so/pricing",
    });

    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        // Recurring provider spend stays off until a human turns it on.
        isActive: false,
        scheduleInterval: "manual",
        nextRunAt: null,
        domain: "openseo.so",
      }),
    );
    expect(mocks.setProvidersForConfig).not.toHaveBeenCalled();
  });

  it("refuses recurring activation without a standing cost ceiling", async () => {
    mocks.getConfigsForProject.mockResolvedValue([]);

    await expect(
      AiVisibilityService.createConfig({
        projectId: "project_1",
        projectMarket: { locationCode: 2840, languageCode: "en" },
        brandName: "OpenSEO",
        domain: "openseo.so",
        scheduleInterval: "weekly",
        isActive: true,
      }),
    ).rejects.toThrow(/approved per-run credit ceiling/i);
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("refuses to clear the ceiling while a recurring config is active", async () => {
    mocks.getConfigById.mockResolvedValue({
      ...config,
      scheduleInterval: "weekly",
      isActive: true,
      maxCostCredits: 100,
    });

    await expect(
      AiVisibilityService.updateConfig(config.id, config.projectId, {
        maxCostCredits: null,
      }),
    ).rejects.toThrow(/approved per-run credit ceiling/i);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
});
