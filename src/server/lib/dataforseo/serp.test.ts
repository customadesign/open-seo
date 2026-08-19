import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

import {
  fetchLocalSerp,
  fetchRankCheckTaskResult,
  postRankCheckTasks,
} from "@/server/lib/dataforseo/serp";

function parseDataforseoRequestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected DataForSEO request body to be a string");
  }
  return JSON.parse(body) as unknown;
}

describe("local SERPs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["maps", "maps"],
    ["local_finder", "local_finder"],
  ] as const)(
    "treats a %s no-results task as an empty metered observation",
    async (searchType, pathSegment) => {
      const path = ["v3", "serp", "google", pathSegment, "live", "advanced"];
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status_code: 20000,
          tasks: [
            {
              status_code: 40501,
              status_message: "No Search Results",
              cost: 0.002,
              path,
              result: null,
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        fetchLocalSerp({
          keyword: "sign shop",
          locationCoordinate: "33.1294592,-117.1201598,15z",
          languageCode: "en",
          searchType,
          device: "mobile",
          depth: 20,
          searchPlaces: false,
        }),
      ).resolves.toEqual({
        data: [],
        billing: { path, costUsd: 0.002 },
      });
    },
  );
});

describe("rank check task queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts queued tasks, maps ids by tag, and sums cost over all entries", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [
          {
            id: "task-a",
            status_code: 20100,
            cost: 0.0006,
            data: { tag: "kw-1:desktop" },
          },
          {
            id: "task-b",
            status_code: 20100,
            cost: 0.0006,
            data: { tag: "kw-1:mobile" },
          },
          {
            id: "task-c",
            status_code: 40006,
            status_message: "Task Limit Exceeded",
            cost: 0.0006,
            data: { tag: "kw-2:desktop" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postRankCheckTasks({
      tasks: [
        { keyword: "alpha", keywordId: "kw-1", device: "desktop" },
        { keyword: "alpha", keywordId: "kw-1", device: "mobile" },
        { keyword: "beta", keywordId: "kw-2", device: "desktop" },
      ],
      locationCode: 2840,
      languageCode: "en",
      depth: 20,
      targetDomain: "example.com",
    });

    expect(
      fetchMock.mock.calls.map(([url]) =>
        typeof url === "string" || url instanceof URL
          ? url.toString()
          : url.url,
      ),
    ).toEqual(["https://api.dataforseo.com/v3/serp/google/organic/task_post"]);

    // Every posted task asks DataForSEO to stop crawling at the target's
    // organic listing — that is what cuts the actual crawl cost for ranking
    // domains without false "not ranking" stops on sitelinks/PAA mentions.
    const stopCrawl = {
      stop_crawl_on_match: [
        { match_value: "example.com", match_type: "with_subdomains" },
      ],
      find_targets_in: ["organic"],
    };
    expect(
      parseDataforseoRequestBody(fetchMock.mock.calls[0]?.[1]),
    ).toMatchObject([stopCrawl, stopCrawl, stopCrawl]);
    expect(result.data).toEqual([
      {
        keyword: "alpha",
        keywordId: "kw-1",
        device: "desktop",
        taskId: "task-a",
      },
      {
        keyword: "alpha",
        keywordId: "kw-1",
        device: "mobile",
        taskId: "task-b",
      },
    ]);
    // The rejected entry's cost is still metered: a charge is a charge.
    expect(result.billing.costUsd).toBeCloseTo(0.0018, 10);
    expect(result.billing.path).toEqual([
      "v3",
      "serp",
      "google",
      "organic",
      "task_post",
    ]);
  });

  it("reports a queued task still in progress as pending", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [{ id: "task-a", status_code: 40602 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRankCheckTaskResult({
      taskId: "task-a",
      keywordId: "kw-1",
      keyword: "alpha",
      targetDomain: "example.com",
    });

    expect(outcome).toEqual({ status: "pending" });
  });

  it("parses a completed queued task into a rank check result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [
          {
            id: "task-a",
            status_code: 20000,
            cost: 0,
            path: ["v3", "serp", "google", "organic", "task_get", "advanced"],
            result: [
              {
                items: [
                  {
                    type: "organic",
                    rank_group: 3,
                    rank_absolute: 4,
                    domain: "www.example.com",
                    url: "https://www.example.com/page",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRankCheckTaskResult({
      taskId: "task-a",
      keywordId: "kw-1",
      keyword: "alpha",
      targetDomain: "example.com",
    });

    expect(outcome).toEqual({
      status: "completed",
      result: {
        keywordId: "kw-1",
        keyword: "alpha",
        position: 3,
        url: "https://www.example.com/page",
        serpFeatures: ["organic"],
        ownedUrls: [{ url: "https://www.example.com/page", position: 3 }],
        competitors: [],
        featureOwnership: [],
      },
    });
  });
});

describe("Bing rank checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the Bing endpoint at full depth with no early stop", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [
          {
            id: "task-a",
            status_code: 20100,
            cost: 0.0006,
            data: { tag: "kw-1:desktop" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postRankCheckTasks({
      engine: "bing",
      tasks: [{ keyword: "alpha", keywordId: "kw-1", device: "desktop" }],
      locationCode: 2840,
      languageCode: "en",
      depth: 40,
      targetDomain: "example.com",
    });

    expect(
      fetchMock.mock.calls.map(([url]) =>
        typeof url === "string" || url instanceof URL
          ? url.toString()
          : url.url,
      ),
    ).toEqual(["https://api.dataforseo.com/v3/serp/bing/organic/task_post"]);

    // Bing has no `find_targets_in`, so `stop_crawl_on_match` could stop on a
    // sitelink or answer-box mention and record a false "not ranking". Neither
    // field may be set (the SDK serializes unset fields as null), and the full
    // configured depth must be crawled.
    const bingBody = parseDataforseoRequestBody(fetchMock.mock.calls[0]?.[1]);
    expect(bingBody).toMatchObject([{ stop_crawl_on_match: null, depth: 40 }]);
    // Bing's task_post has no `find_targets_in` field at all, which is exactly
    // why the early stop above must stay unset.
    expect(JSON.stringify(bingBody)).not.toContain("find_targets_in");

    expect(result.billing.path).toEqual([
      "v3",
      "serp",
      "bing",
      "organic",
      "task_post",
    ]);
  });

  it("collects Bing task results from the Bing task_get endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            cost: 0.0006,
            path: ["v3", "serp", "bing", "organic", "task_get", "advanced"],
            result: [
              {
                items: [
                  {
                    type: "organic",
                    rank_group: 3,
                    domain: "example.com",
                    url: "https://example.com/a",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchRankCheckTaskResult({
      engine: "bing",
      taskId: "task-a",
      keywordId: "kw-1",
      keyword: "alpha",
      targetDomain: "example.com",
    });

    expect(
      fetchMock.mock.calls.map(([url]) =>
        typeof url === "string" || url instanceof URL
          ? url.toString()
          : url.url,
      ),
    ).toEqual([
      "https://api.dataforseo.com/v3/serp/bing/organic/task_get/advanced/task-a",
    ]);
    expect(outcome).toEqual({
      status: "completed",
      result: {
        keywordId: "kw-1",
        keyword: "alpha",
        position: 3,
        url: "https://example.com/a",
        serpFeatures: ["organic"],
        ownedUrls: [{ url: "https://example.com/a", position: 3 }],
        competitors: [],
        featureOwnership: [],
      },
    });
  });
});
