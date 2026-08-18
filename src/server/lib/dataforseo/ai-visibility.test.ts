import { beforeEach, describe, expect, it, vi } from "vitest";

const { serpApiMock, googleAiModeLiveAdvancedMock } = vi.hoisted(() => ({
  serpApiMock: vi.fn(),
  googleAiModeLiveAdvancedMock: vi.fn(),
}));

vi.mock("dataforseo-client", () => ({
  SerpGoogleAiModeLiveAdvancedRequestInfo: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@/server/lib/dataforseo/core", () => ({
  serpApi: serpApiMock,
}));

import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import { fetchAiVisibilityAnswer } from "./ai-visibility";

const path = ["v3", "serp", "google", "ai_mode", "live", "advanced"];

function task(result: unknown) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    path,
    cost: 0.00425,
    result: [result],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  serpApiMock.mockReturnValue({
    googleAiModeLiveAdvanced: googleAiModeLiveAdvancedMock,
  });
});

describe("Google AI Mode visibility answers", () => {
  it("normalizes a successful billed result", async () => {
    googleAiModeLiveAdvancedMock.mockResolvedValue({
      status_code: 20000,
      tasks: [
        task({
          items: [
            {
              type: "ai_overview",
              markdown: "Acme is a good option.",
              references: [{ url: "https://acme.com/about", title: "About" }],
            },
          ],
        }),
      ],
    });

    await expect(
      fetchAiVisibilityAnswer({
        provider: "google_ai_mode",
        prompt: "What is Acme?",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).resolves.toEqual({
      data: {
        text: "Acme is a good option.",
        modelName: null,
        references: [{ url: "https://acme.com/about", title: "About" }],
      },
      billing: { path, costUsd: 0.00425 },
    });
  });

  it("carries billing when a successful task has an invalid result shape", async () => {
    googleAiModeLiveAdvancedMock.mockResolvedValue({
      status_code: 20000,
      tasks: [task(null)],
    });

    const rejection = fetchAiVisibilityAnswer({
      provider: "google_ai_mode",
      prompt: "What is Acme?",
      locationCode: 2840,
      languageCode: "en",
    });

    await expect(rejection).rejects.toBeInstanceOf(DataforseoChargedTaskError);
    await expect(rejection).rejects.toMatchObject({
      message: "DataForSEO google/ai_mode returned an invalid result shape",
      billing: { path, costUsd: 0.00425 },
    });
  });

  it("carries billing when the result items field has the wrong type", async () => {
    googleAiModeLiveAdvancedMock.mockResolvedValue({
      status_code: 20000,
      tasks: [task({ items: "not-an-array" })],
    });

    await expect(
      fetchAiVisibilityAnswer({
        provider: "google_ai_mode",
        prompt: "What is Acme?",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).rejects.toMatchObject({
      billing: { path, costUsd: 0.00425 },
    });
  });

  it("does not treat a missing item collection as a valid empty answer", async () => {
    googleAiModeLiveAdvancedMock.mockResolvedValue({
      status_code: 20000,
      tasks: [task({})],
    });

    await expect(
      fetchAiVisibilityAnswer({
        provider: "google_ai_mode",
        prompt: "What is Acme?",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).rejects.toMatchObject({
      billing: { path, costUsd: 0.00425 },
    });
  });
});
