import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn().mockResolvedValue("encoded-credentials"),
}));

import {
  createAuthenticatedFetch,
  onPageApi,
} from "@/server/lib/dataforseo/core";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataForSEO OnPage transport", () => {
  it("does not retry a Lighthouse HTTP 5xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream failure", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(onPageApi().lighthouseLiveJson([])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("DataForSEO shared transport", () => {
  it.each([
    "/v3/dataforseo_labs/google/related_keywords/live",
    "/v3/keywords_data/google_ads/search_volume/live",
    "/v3/serp/google/maps/live/advanced",
    "/v3/business_data/business_listings/search/live",
    "/v3/backlinks/summary/live",
    "/v3/ai_optimization/llm_mentions/search/live",
    "/v3/serp/google/organic/task_post",
  ])("does not retry a potentially billed HTTP 5xx for %s", async (path) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream failure", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAuthenticatedFetch()(`https://api.dataforseo.com${path}`, {
        method: "POST",
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("still retries a free idempotent read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream failure", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAuthenticatedFetch()(
        "https://api.dataforseo.com/v3/serp/google/locations/US",
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function sentBody(fetchMock: ReturnType<typeof vi.fn>): string {
  const init: unknown = fetchMock.mock.calls[0]?.[1];
  if (!init || typeof init !== "object" || !("body" in init)) {
    throw new Error("Expected a request init with a body");
  }
  const { body } = init;
  if (typeof body !== "string") throw new Error("Expected a string body");
  return body;
}

describe("DataForSEO retired SERP target parameters", () => {
  it("strips every retired key, including SDK nulls, from SERP bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createAuthenticatedFetch()(
      "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
      {
        method: "POST",
        body: JSON.stringify([
          {
            keyword: "alpha",
            depth: 20,
            stop_crawl_on_match: null,
            target_search_mode: "any",
            find_targets_in: ["organic"],
            ignore_targets_in: ["paid"],
          },
        ]),
      },
    );

    expect(JSON.parse(sentBody(fetchMock))).toEqual([
      { keyword: "alpha", depth: 20 },
    ]);
  });

  it("leaves non-SERP bodies untouched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify([
      { target: "example.com", find_targets_in: 1 },
    ]);

    await createAuthenticatedFetch()(
      "https://api.dataforseo.com/v3/backlinks/summary/live",
      { method: "POST", body },
    );

    expect(sentBody(fetchMock)).toBe(body);
  });
});
