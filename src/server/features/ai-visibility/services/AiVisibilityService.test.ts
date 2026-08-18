import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityService } from "./AiVisibilityService";

const mocks = vi.hoisted(() => ({
  getPrimaryConfigForProject: vi.fn(),
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
  addProviders: vi.fn(),
  addPrompts: vi.fn(),
  getActivePromptsForConfig: vi.fn(),
  getProvidersForConfig: vi.fn(),
  tryCreateRun: vi.fn(),
  updateRun: vi.fn(),
  markRunFailed: vi.fn(),
  getActiveRunForConfig: vi.fn(),
  getRecentCompletedRuns: vi.fn(),
  getRecentFinishedRuns: vi.fn(),
  insertObservations: vi.fn(),
  getObservationsForRuns: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  customerHasPaidPlan: vi.fn(),
  checkUsageCreditsDepleted: vi.fn(),
  answer: vi.fn(),
}));

vi.mock(
  "@/server/features/ai-visibility/repositories/AiVisibilityRepository",
  () => ({ AiVisibilityRepository: mocks }),
);
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));
vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
  checkUsageCreditsDepleted: mocks.checkUsageCreditsDepleted,
  getOrCreateOrganizationCustomer: vi.fn(async () => ({ id: "cus_1" })),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({ aiVisibility: { answer: mocks.answer } }),
}));

const config = {
  id: "config_1",
  projectId: "project_1",
  brandName: "Acme",
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "en",
  maxCostCredits: null,
  lastSkipReason: null,
};

const billingCustomer = {
  userId: "user_1",
  userEmail: "user@example.com",
  organizationId: "org_1",
  projectId: "project_1",
};

const projectInput = {
  projectId: "project_1",
  projectName: "Acme",
  domain: "acme.com" as string | null,
  locationCode: 2840,
  languageCode: "en",
  billingCustomer,
};

describe("AiVisibilityService.ensureBaselineRun", () => {
  beforeEach(() => {
    mocks.getPrimaryConfigForProject.mockResolvedValue(config);
    mocks.getRecentCompletedRuns.mockResolvedValue([]);
    mocks.getRecentFinishedRuns.mockResolvedValue([]);
    mocks.getActiveRunForConfig.mockResolvedValue(null);
    mocks.getActivePromptsForConfig.mockResolvedValue([
      { id: "prompt_1", prompt: "What is Acme?" },
    ]);
    mocks.getProvidersForConfig.mockResolvedValue(["chatgpt_search", "gemini"]);
    mocks.tryCreateRun.mockResolvedValue(true);
    mocks.isHostedServerAuthMode.mockResolvedValue(false);
  });

  it("seeds defaults and opens a run on a first visit", async () => {
    mocks.getPrimaryConfigForProject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(config);

    const result = await AiVisibilityService.ensureBaselineRun(projectInput);

    expect(mocks.createConfig).toHaveBeenCalledTimes(1);
    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleInterval: "manual",
        isActive: false,
      }),
    );
    expect(mocks.addProviders).toHaveBeenCalledWith("config_1", [
      "chatgpt_search",
      "gemini",
      "google_ai_mode",
    ]);
    expect(mocks.addPrompts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ prompt: "What is Acme?" }),
      ]),
    );
    expect(result).toMatchObject({
      queued: true,
      plan: { brandName: "Acme", domain: "acme.com" },
    });
    // prompts × providers, so a partially-written run can be detected later.
    expect(mocks.tryCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        observationsTotal: 2,
        trigger: "manual",
        maxCostCredits: null,
      }),
    );
  });

  it("does not create a second config once one exists", async () => {
    await AiVisibilityService.ensureBaselineRun(projectInput);

    expect(mocks.createConfig).not.toHaveBeenCalled();
    expect(mocks.tryCreateRun).toHaveBeenCalledTimes(1);
  });

  it("skips a run while today's baseline is still fresh", async () => {
    mocks.getRecentCompletedRuns.mockResolvedValue([
      { id: "run_1", startedAt: new Date().toISOString() },
    ]);

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toEqual({ queued: false, reason: "not_due" });
    expect(mocks.tryCreateRun).not.toHaveBeenCalled();
  });

  it("does not retry a failed baseline within its 24-hour window", async () => {
    mocks.getPrimaryConfigForProject.mockResolvedValue({
      ...config,
      lastRunAt: new Date().toISOString(),
    });

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toEqual({ queued: false, reason: "not_due" });
    expect(mocks.tryCreateRun).not.toHaveBeenCalled();
  });

  it("allows a failed baseline to retry after 24 hours", async () => {
    mocks.getPrimaryConfigForProject.mockResolvedValue({
      ...config,
      lastRunAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toMatchObject({ queued: true });
    expect(mocks.tryCreateRun).toHaveBeenCalledTimes(1);
  });

  it("yields to a run that is already in flight", async () => {
    mocks.getActiveRunForConfig.mockResolvedValue({
      id: "run_1",
      startedAt: new Date().toISOString(),
    });

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toEqual({ queued: false, reason: "already_running" });
    expect(mocks.tryCreateRun).not.toHaveBeenCalled();
  });

  it("refuses to spend on a free plan and records why", async () => {
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.customerHasPaidPlan.mockResolvedValue(false);

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toEqual({ queued: false, reason: "plan_required" });
    expect(mocks.updateConfig).toHaveBeenCalledWith("config_1", {
      lastSkipReason: "plan_required",
    });
    expect(mocks.tryCreateRun).not.toHaveBeenCalled();
  });

  it("refuses to spend with no credits left", async () => {
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.customerHasPaidPlan.mockResolvedValue(true);
    mocks.checkUsageCreditsDepleted.mockResolvedValue({ depleted: true });

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toEqual({ queued: false, reason: "insufficient_credits" });
    expect(mocks.tryCreateRun).not.toHaveBeenCalled();
  });

  it("refuses a baseline whose conservative estimate exceeds its ceiling", async () => {
    mocks.getPrimaryConfigForProject.mockResolvedValue({
      ...config,
      maxCostCredits: 1,
    });

    await expect(
      AiVisibilityService.ensureBaselineRun(projectInput),
    ).resolves.toEqual({ queued: false, reason: "cost_ceiling" });
    expect(mocks.updateConfig).toHaveBeenCalledWith("config_1", {
      lastSkipReason: "cost_ceiling",
    });
    expect(mocks.tryCreateRun).not.toHaveBeenCalled();
  });

  it("does nothing for a project with no domain", async () => {
    await expect(
      AiVisibilityService.ensureBaselineRun({ ...projectInput, domain: null }),
    ).resolves.toEqual({ queued: false, reason: "no_domain" });
    expect(mocks.getPrimaryConfigForProject).not.toHaveBeenCalled();
  });
});

describe("AiVisibilityService.getState", () => {
  beforeEach(() => {
    mocks.getPrimaryConfigForProject.mockResolvedValue(config);
    mocks.getActiveRunForConfig.mockResolvedValue(null);
    mocks.getRecentFinishedRuns.mockResolvedValue([
      {
        id: "run_failed",
        status: "failed",
        startedAt: "2026-08-18T00:00:00.000Z",
        completedAt: "2026-08-18T00:01:00.000Z",
      },
    ]);
    mocks.getObservationsForRuns.mockResolvedValue([]);
  });

  it("surfaces a failed first baseline as an explicit terminal state", async () => {
    await expect(
      AiVisibilityService.getState("project_1"),
    ).resolves.toMatchObject({
      configured: true,
      running: false,
      latest: {
        status: "failed",
        capturedAt: "2026-08-18T00:01:00.000Z",
        summary: {
          visibilityPercent: null,
          readableObservations: 0,
        },
      },
    });
    expect(mocks.getRecentFinishedRuns).toHaveBeenCalledWith("config_1", 3);
  });
});

const plan = {
  runId: "run_1",
  configId: "config_1",
  brandName: "Acme",
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "en",
  prompts: [{ id: "prompt_1", prompt: "What is Acme?" }],
  providers: ["chatgpt_search", "gemini"] as const,
  maxCostCredits: null,
};

type CapturedObservation = {
  observation: {
    provider: string;
    outcome: string;
    status: string;
    mentionCount: number;
  };
};

describe("AiVisibilityService.executeRun", () => {
  beforeEach(() => {
    mocks.insertObservations.mockReset();
    mocks.updateRun.mockReset();
    mocks.markRunFailed.mockReset();
    mocks.answer.mockReset();
  });

  it("records a failed provider as unavailable and still completes the run", async () => {
    const captured: CapturedObservation[] = [];
    mocks.insertObservations.mockImplementation(
      (rows: CapturedObservation[]) => {
        captured.push(...rows);
        return Promise.resolve();
      },
    );

    mocks.answer.mockImplementation((input: { provider: string }) =>
      input.provider === "gemini"
        ? Promise.reject(new Error("gemini down"))
        : Promise.resolve({
            text: "Acme is popular.",
            modelName: "gpt-5",
            references: [],
          }),
    );

    await AiVisibilityService.executeRun(
      { ...plan, providers: [...plan.providers] },
      billingCustomer,
    );

    expect(
      captured.map((row) => [
        row.observation.provider,
        row.observation.outcome,
      ]),
    ).toEqual([
      ["chatgpt_search", "brand_mentioned"],
      ["gemini", "unavailable"],
    ]);
    expect(captured[0].observation.mentionCount).toBe(1);
    expect(captured[1].observation.status).toBe("failed");
    expect(mocks.updateRun).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({
        status: "completed",
        observationsCompleted: 1,
      }),
    );
  });

  it("fails the run when every provider was unavailable", async () => {
    mocks.answer.mockRejectedValue(new Error("all down"));

    await AiVisibilityService.executeRun(
      { ...plan, providers: [...plan.providers] },
      billingCustomer,
    );

    expect(mocks.updateRun).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({
        status: "failed",
        errorMessage: "Every provider was unavailable",
      }),
    );
  });

  it("runs provider calls serially so credit checks cannot race", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.answer.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { text: "Acme", modelName: null, references: [] };
    });

    await AiVisibilityService.executeRun(
      {
        ...plan,
        prompts: [
          { id: "prompt_1", prompt: "What is Acme?" },
          { id: "prompt_2", prompt: "Why Acme?" },
        ],
        providers: [...plan.providers],
      },
      billingCustomer,
    );

    expect(maxInFlight).toBe(1);
    expect(mocks.answer).toHaveBeenCalledTimes(4);
  });

  it("does not execute a plan that no longer fits its ceiling", async () => {
    await AiVisibilityService.executeRun(
      { ...plan, providers: [...plan.providers], maxCostCredits: 1 },
      billingCustomer,
    );

    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.updateRun).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({
        status: "failed",
        errorMessage: "Run exceeds the approved credit ceiling",
      }),
    );
  });

  it("marks the run failed when observation persistence rejects", async () => {
    mocks.answer.mockResolvedValue({
      text: "Acme",
      modelName: null,
      references: [],
    });
    mocks.insertObservations.mockRejectedValue(
      new Error("observation write down"),
    );

    await expect(
      AiVisibilityService.executeRun(
        { ...plan, providers: [...plan.providers] },
        billingCustomer,
      ),
    ).rejects.toThrow("observation write down");

    expect(mocks.markRunFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      "run_1",
      "observation write down",
    );
  });

  it("marks the run failed when the final summary update rejects", async () => {
    mocks.answer.mockResolvedValue({
      text: "Acme",
      modelName: null,
      references: [],
    });
    mocks.updateRun
      .mockRejectedValueOnce(new Error("summary write down"))
      .mockResolvedValue(undefined);

    await expect(
      AiVisibilityService.executeRun(
        { ...plan, providers: [...plan.providers] },
        billingCustomer,
      ),
    ).rejects.toThrow("summary write down");

    expect(mocks.markRunFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markRunFailed).toHaveBeenCalledWith(
      "run_1",
      "summary write down",
    );
  });
});
