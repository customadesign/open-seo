import { env } from "cloudflare:workers";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import * as z from "zod";
import { verifyOnePagePmSsoToken } from "@/lib/onepagepm-sso";

// Mounted by Better Auth under /api/auth/sso/onepagepm. The public entry point
// is the thin /api/sso route, which calls this and turns the result into a
// redirect — keeping the redirect logic out of the auth layer.
export const ONEPAGEPM_SSO_ENDPOINT_PATH = "/sso/onepagepm";

export function hasOnePagePmSsoConfig() {
  return Boolean(env.OPENSEO_SSO_SECRET?.trim());
}

export function createOnePagePmSsoPlugin() {
  return {
    id: "openseo-onepagepm-sso" as const,
    endpoints: {
      onePagePmSso: createAuthEndpoint(
        ONEPAGEPM_SSO_ENDPOINT_PATH,
        {
          method: "GET",
          query: z.object({ token: z.string().min(1) }),
        },
        async (ctx) => {
          const secret = env.OPENSEO_SSO_SECRET?.trim();
          if (!secret) {
            // Unconfigured is an operator error, not a failed login. Say so in
            // logs; the caller still shows the user a plain sign-in page.
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "OPENSEO_SSO_SECRET is not configured",
            });
          }

          const claims = await verifyOnePagePmSsoToken(ctx.query.token, secret);
          if (!claims) {
            throw new APIError("UNAUTHORIZED");
          }

          const internal = ctx.context.internalAdapter;

          let user = await internal.findUserByEmail(claims.email);

          if (!user) {
            // First arrival from OnePagePM. The email is asserted by a token we
            // just verified, so it is as trustworthy as the shared secret —
            // mark it verified rather than sending a verification mail the
            // user would have no reason to expect.
            const created = await internal.createUser({
              email: claims.email,
              name: claims.email,
              emailVerified: true,
            });
            user = { user: created, accounts: [] };
          }

          const session = await internal.createSession(user.user.id, false);

          await setSessionCookie(ctx, { session, user: user.user });

          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
