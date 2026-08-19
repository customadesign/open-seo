import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  ONEPAGEPM_SSO_AUDIENCE,
  verifyOnePagePmSsoToken,
} from "@/lib/onepagepm-sso";

const SECRET = "test-secret-at-least-32-characters-long!";
const key = new TextEncoder().encode(SECRET);

async function mint(
  overrides: {
    aud?: string;
    sub?: string;
    email?: string;
    iat?: number;
    exp?: number;
    alg?: string;
    key?: Uint8Array;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: overrides.email ?? "pat@murphyconsulting.us" })
    .setProtectedHeader({ alg: overrides.alg ?? "HS256" })
    .setSubject(overrides.sub ?? "user-123")
    .setAudience(overrides.aud ?? ONEPAGEPM_SSO_AUDIENCE)
    .setIssuedAt(overrides.iat ?? now)
    .setExpirationTime(overrides.exp ?? now + 60)
    .sign(overrides.key ?? key);
}

describe("verifyOnePagePmSsoToken", () => {
  it("accepts a well-formed token and lowercases the email", async () => {
    const token = await mint({ email: "Pat@MurphyConsulting.us" });

    await expect(verifyOnePagePmSsoToken(token, SECRET)).resolves.toEqual({
      userId: "user-123",
      email: "pat@murphyconsulting.us",
    });
  });

  it("rejects a token minted for a sibling integration", async () => {
    // AdPilot/Onboard/Signal all mint HS256 tokens in the same shape; only the
    // audience separates them.
    const token = await mint({ aud: "adpilot-sso" });

    await expect(verifyOnePagePmSsoToken(token, SECRET)).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mint({
      key: new TextEncoder().encode("a-completely-different-secret-value-x"),
    });

    await expect(verifyOnePagePmSsoToken(token, SECRET)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mint({ iat: now - 600, exp: now - 300 });

    await expect(verifyOnePagePmSsoToken(token, SECRET)).resolves.toBeNull();
  });

  it("rejects a correctly-signed token with an over-long lifetime", async () => {
    // Signature and audience are valid here — only the issuer's chosen expiry
    // is wrong, which jose alone would happily accept.
    const now = Math.floor(Date.now() / 1000);
    const token = await mint({ iat: now, exp: now + 60 * 60 * 24 });

    await expect(verifyOnePagePmSsoToken(token, SECRET)).resolves.toBeNull();
  });

  it("rejects an unsigned token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url")}.${Buffer.from(
      JSON.stringify({
        sub: "user-123",
        email: "pat@murphyconsulting.us",
        aud: ONEPAGEPM_SSO_AUDIENCE,
        iat: now,
        exp: now + 60,
      }),
    ).toString("base64url")}.`;

    await expect(verifyOnePagePmSsoToken(unsigned, SECRET)).resolves.toBeNull();
  });

  it("rejects a token carrying no usable email", async () => {
    const token = await mint({ email: "not-an-email" });

    await expect(verifyOnePagePmSsoToken(token, SECRET)).resolves.toBeNull();
  });
});
