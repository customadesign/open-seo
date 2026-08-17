import { describe, expect, it, vi } from "vitest";

vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: {} }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  MAX_TASKS_PER_POST: 100,
  fetchRankCheckTaskResult: vi.fn(),
}));
vi.mock("@/server/workflows/pgStep", () => ({ pgStep: vi.fn() }));
import { liveFallbackTaskLimit } from "./rankCheckPaths";

describe("queued rank fallback budget", () => {
  it("does not spend past the queued reserve", () => {
    expect(
      liveFallbackTaskLimit({
        queuedTaskCount: 101,
        stragglerCount: 101,
        serpDepth: 10,
        maxCostCredits: 77,
      }),
    ).toBe(0);
    expect(
      liveFallbackTaskLimit({
        queuedTaskCount: 101,
        stragglerCount: 101,
        serpDepth: 10,
        maxCostCredits: 80,
      }),
    ).toBe(0);
    expect(
      liveFallbackTaskLimit({
        queuedTaskCount: 101,
        stragglerCount: 101,
        serpDepth: 10,
        maxCostCredits: 84,
      }),
    ).toBe(2);
  });

  it("preserves explicit manual compatibility when no ceiling was supplied", () => {
    expect(
      liveFallbackTaskLimit({
        queuedTaskCount: 5,
        stragglerCount: 3,
        serpDepth: 10,
      }),
    ).toBe(3);
  });
});
