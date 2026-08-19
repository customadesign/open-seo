import { jwtVerify } from "jose";

// Audience must match the value OnePagePM mints with (src/lib/openseo-sso.ts
// there). Keeping it explicit stops a token minted for a sibling integration
// — AdPilot, Onboard, Signal all share the same signing style — from being
// replayed here.
export const ONEPAGEPM_SSO_AUDIENCE = "openseo-sso";

// OnePagePM mints 60s tokens. Allowing a little more absorbs clock skew
// between Render and the NAS without widening the replay window meaningfully.
const MAX_TOKEN_LIFETIME_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 5;

export type OnePagePmSsoClaims = {
  userId: string;
  email: string;
};

/**
 * Verify a OnePagePM SSO handoff token.
 *
 * Returns null for every rejection rather than throwing or distinguishing
 * causes — the caller redirects to sign-in either way, and a caller that
 * cannot tell "bad signature" from "expired" cannot leak that distinction to
 * an attacker probing the endpoint.
 */
export async function verifyOnePagePmSsoToken(
  token: string,
  secret: string,
): Promise<OnePagePmSsoClaims | null> {
  if (!token || !secret) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        // Pinning the algorithm is what stops `alg: none` and an RS256
        // confusion attack where the HMAC secret is used as a public key.
        algorithms: ["HS256"],
        audience: ONEPAGEPM_SSO_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      },
    );

    const { sub, email, iat, exp } = payload;

    // jose enforces exp, but not that the issuer chose a short one. A token
    // minted with a year-long expiry would verify happily otherwise.
    if (typeof iat !== "number" || typeof exp !== "number") {
      return null;
    }
    if (exp - iat > MAX_TOKEN_LIFETIME_SECONDS) {
      return null;
    }

    if (typeof sub !== "string" || !sub) {
      return null;
    }
    if (typeof email !== "string" || !email.includes("@")) {
      return null;
    }

    return { userId: sub, email: email.toLowerCase() };
  } catch {
    return null;
  }
}
