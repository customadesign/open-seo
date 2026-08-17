import { describe, expect, it } from "vitest";
import {
  isScheduledRecipientAllowed,
  isTestRecipientAllowed,
  parseDeliveryTestMode,
  parseRecipientAllowlist,
} from "./reportTestRecipients";

const guard = {
  testMode: true,
  allowlist: parseRecipientAllowlist("QA@Example.com, ops@example.com"),
};

describe("report delivery recipient guard", () => {
  it("stays in test mode unless a deployment explicitly opts out", () => {
    expect(parseDeliveryTestMode(undefined)).toBe(true);
    expect(parseDeliveryTestMode("")).toBe(true);
    expect(parseDeliveryTestMode("no")).toBe(true);
    expect(parseDeliveryTestMode("0")).toBe(true);
    expect(parseDeliveryTestMode(" FALSE ")).toBe(false);
  });

  it("sends to nobody when test mode has an empty allowlist", () => {
    const closed = { testMode: true, allowlist: parseRecipientAllowlist("") };
    expect(isScheduledRecipientAllowed("client@acme.test", closed)).toBe(false);
    expect(
      isTestRecipientAllowed({
        email: "client@acme.test",
        requesterEmail: null,
        guard: closed,
      }),
    ).toBe(false);
  });

  it("holds back non-allowlisted recipients while test mode is on", () => {
    expect(isScheduledRecipientAllowed("qa@example.com", guard)).toBe(true);
    expect(isScheduledRecipientAllowed("client@acme.test", guard)).toBe(false);
    expect(
      isScheduledRecipientAllowed("client@acme.test", {
        ...guard,
        testMode: false,
      }),
    ).toBe(true);
  });

  it("limits manual test sends to the requester or the allowlist", () => {
    const requesterEmail = "me@agency.test";
    expect(
      isTestRecipientAllowed({
        email: "Me@Agency.test",
        requesterEmail,
        guard,
      }),
    ).toBe(true);
    expect(
      isTestRecipientAllowed({
        email: "ops@example.com",
        requesterEmail,
        guard,
      }),
    ).toBe(true);
    expect(
      isTestRecipientAllowed({
        email: "client@acme.test",
        requesterEmail,
        guard,
      }),
    ).toBe(false);
  });
});
