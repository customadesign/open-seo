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
