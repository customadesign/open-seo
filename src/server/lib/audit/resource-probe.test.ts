import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResourceProbeBudget,
  probeResource,
  probeResources,
} from "@/server/lib/audit/resource-probe";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeResource", () => {
  it("uses HEAD and does not GET when HEAD returns a real status", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await probeResource("https://example.com/missing");
    expect(result).toMatchObject({ kind: "ok", statusCode: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/missing",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("falls back to GET when HEAD is rejected", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, { status: 405 });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await probeResource("https://example.com/file");
    expect(result).toMatchObject({ kind: "ok", statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips private and invalid URLs without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeResource("not a url")).toEqual({
      kind: "skipped",
      reason: "invalid",
    });
    expect(await probeResource("http://127.0.0.1/")).toEqual({
      kind: "skipped",
      reason: "unsafe",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("probeResources", () => {
  it("dedupes targets and respects the remaining budget", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const budget = createResourceProbeBudget(1);
    const results = await probeResources(
      [
        "https://example.com/a",
        "https://example.com/a",
        "https://example.com/b",
      ],
      budget,
    );
    expect(results.get("https://example.com/a")).toMatchObject({
      kind: "ok",
      statusCode: 200,
    });
    expect(results.get("https://example.com/b")).toEqual({
      kind: "skipped",
      reason: "cap",
    });
    expect(budget.attempted).toBe(1);
    expect(budget.skippedByCap).toBe(1);
  });
});
