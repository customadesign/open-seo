import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import {
  describeLockRemaining,
  lockRemainingMs,
  registerFailedAttempt,
} from "@/lib/auth-lockout";
import { LoginAttemptRepository } from "@/server/auth/repositories/LoginAttemptRepository";

const SIGN_IN_EMAIL_PATH = "/sign-in/email";

function readEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const email = Reflect.get(body, "email");
  if (typeof email !== "string") return null;

  const normalized = email.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

// Better Auth resolves a rejected sign-in by setting the thrown APIError as the
// endpoint's return value, so the after-hook sees it rather than a throw.
function isRejectedSignIn(returned: unknown) {
  return returned instanceof APIError;
}

// Only a payload that actually carries the signed-in user clears the counter.
// Recognising failure and recognising success are kept independent on purpose:
// if Better Auth ever changes this shape, the counter stops moving in both
// directions instead of locking people out of accounts they signed into
// correctly.
function isAcceptedSignIn(returned: unknown) {
  return (
    !!returned &&
    typeof returned === "object" &&
    !(returned instanceof APIError) &&
    "user" in returned
  );
}

/**
 * Escalating lockout on `/sign-in/email`.
 *
 * Deliberately scoped to that one path: the OnePagePM SSO handoff lands on
 * `/sso/onepagepm` and never presents a password, so a locked account can still
 * be reached the way staff normally arrive. That is what keeps the lock from
 * doubling as a denial-of-service — knowing someone's email lets you stop them
 * typing a password, not lock them out of the product.
 */
export function createLoginLockoutPlugin() {
  const matcher = (context: { path?: string }) =>
    context.path === SIGN_IN_EMAIL_PATH;

  return {
    id: "openseo-login-lockout" as const,
    hooks: {
      before: [
        {
          matcher,
          handler: createAuthMiddleware(async (context) => {
            const email = readEmail(context.body);
            if (!email) return;

            const state = await LoginAttemptRepository.findByEmail(email);
            const remainingMs = lockRemainingMs(state, new Date());
            if (remainingMs <= 0) return;

            throw new APIError("TOO_MANY_REQUESTS", {
              message: `Too many failed sign-in attempts. Try again in ${describeLockRemaining(remainingMs)}.`,
            });
          }),
        },
      ],
      after: [
        {
          matcher,
          handler: createAuthMiddleware(async (context) => {
            const email = readEmail(context.body);
            if (!email) return;

            const returned = context.context.returned;
            if (isRejectedSignIn(returned)) {
              const state = await LoginAttemptRepository.findByEmail(email);
              await LoginAttemptRepository.save(
                email,
                registerFailedAttempt(state, new Date()),
              );
              return;
            }

            if (isAcceptedSignIn(returned)) {
              await LoginAttemptRepository.clear(email);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
