import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAiVisibilityTaskResult,
  postAiVisibilityTasks,
} from "./ai-visibility";

const mocks = vi.hoisted(() => ({
  chatPost: vi.fn(),
  chatGet: vi.fn(),
  geminiPost: vi.fn(),
  geminiGet: vi.fn(),
  aiModePost: vi.fn(),
  aiModeGet: vi.fn(),
}));

vi.mock("@/server/lib/dataforseo/core", () => ({
  aiOptimizationApi: () => ({
    chatGptLlmScraperTaskPost: mocks.chatPost,
    chatGptLlmScraperTaskGetAdvanced: mocks.chatGet,
    geminiLlmResponsesTaskPost: mocks.geminiPost,
    geminiLlmResponsesTaskGet: mocks.geminiGet,
  }),
  serpApi: () => ({
    googleAiModeTaskPost: mocks.aiModePost,
    googleAiModeTaskGetAdvanced: mocks.aiModeGet,
  }),
}));

function completedTask(result: Record<string, unknown>, cost = 0.0012) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "task-1",
        status_code: 20000,
        status_message: "Ok.",
        cost,
        result: [result],
      },
    ],
  };
}

describe("AI visibility DataForSEO boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forces live web search when posting ChatGPT visibility prompts", async () => {
    mocks.chatPost.mockResolvedValue({
      status_code: 20000,
      tasks: [
        {
          id: "task-1",
          status_code: 20100,
          cost: 0.0012,
          data: { tag: "prompt-1" },
        },
      ],
    });

    await expect(
      postAiVisibilityTasks({
        provider: "chatgpt_search",
        tasks: [{ promptId: "prompt-1", prompt: "Best SEO platforms?" }],
        locationCode: 2840,
        languageCode: "en",
      }),
    ).resolves.toMatchObject({
      data: [{ promptId: "prompt-1", taskId: "task-1" }],
      billing: { costUsd: 0.0012 },
    });
    expect(mocks.chatPost).toHaveBeenCalledWith([
      expect.objectContaining({
        force_web_search: true,
        expand_citations: true,
        tag: "prompt-1",
      }),
    ]);
  });

  it("normalizes ChatGPT answer text, model, and cited sources", async () => {
    mocks.chatGet.mockResolvedValue(
      completedTask({
        model: "gpt-search",
        markdown: "OpenSEO is cited.",
        sources: [{ url: "https://www.openseo.so/docs", domain: "openseo.so" }],
      }),
    );

    await expect(
      fetchAiVisibilityTaskResult({
        provider: "chatgpt_search",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      settledCostUsd: 0.0012,
      answer: {
        text: "OpenSEO is cited.",
        modelName: "gpt-search",
        citations: [
          {
            url: "https://www.openseo.so/docs",
            domain: "openseo.so",
            position: 1,
          },
        ],
      },
    });
  });

  it("normalizes Gemini message sections and redirect citations", async () => {
    mocks.geminiGet.mockResolvedValue(
      completedTask(
        {
          model_name: "gemini-2.5-pro",
          items: [
            {
              type: "message",
              sections: [
                {
                  text: "OpenSEO appears in the answer.",
                  annotations: [
                    { title: "OpenSEO", url: "https://openseo.so/" },
                  ],
                },
              ],
            },
          ],
        },
        0.0073,
      ),
    );

    await expect(
      fetchAiVisibilityTaskResult({ provider: "gemini", taskId: "task-1" }),
    ).resolves.toMatchObject({
      status: "completed",
      settledCostUsd: 0.0073,
      answer: {
        text: "OpenSEO appears in the answer.",
        modelName: "gemini-2.5-pro",
        citations: [{ domain: "openseo.so" }],
      },
    });
  });

  it("normalizes Google AI Mode overview text and references", async () => {
    mocks.aiModeGet.mockResolvedValue(
      completedTask({
        items: [
          {
            type: "ai_overview",
            markdown: "OpenSEO is an SEO platform.",
            references: [
              { url: "https://openseo.so/features", domain: "openseo.so" },
            ],
          },
        ],
      }),
    );

    await expect(
      fetchAiVisibilityTaskResult({
        provider: "google_ai_mode",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      answer: {
        text: "OpenSEO is an SEO platform.",
        citations: [{ domain: "openseo.so" }],
      },
    });
  });
});
