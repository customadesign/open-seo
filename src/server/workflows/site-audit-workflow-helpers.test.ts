import { describe, expect, it } from "vitest";
import { classifyFetchError } from "@/server/workflows/site-audit-workflow-helpers";

describe("classifyFetchError", () => {
  it("classifies DNS failures from Node-style cause codes", () => {
    const error = new Error("fetch failed");
    error.cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    expect(classifyFetchError(error)).toBe("dns");
  });

  it("classifies malformed URL errors", () => {
    expect(classifyFetchError(new TypeError("Failed to parse URL"))).toBe(
      "malformed",
    );
  });

  it("classifies everything else as a generic network failure", () => {
    expect(classifyFetchError(new Error("The operation was aborted"))).toBe(
      "network",
    );
  });
});
