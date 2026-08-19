// Escalating lockout for password sign-in.
//
// Three consecutive failures on one email arm a lock; each further lock on that
// email lasts longer. An attacker's throughput collapses toward three guesses a
// day while an honest typo costs fifteen minutes, once. The ladder resets after
// a clean day so a mistake last month doesn't start someone at an hour.
//
// Keyed on the submitted email, not the user id, so attempts against addresses
// that have no account are counted too — otherwise the difference between "no
// such user" and "wrong password" leaks through how long guessing stays cheap.

export const MAX_FAILED_ATTEMPTS = 3;

// Indexed by lock level - 1; the last entry repeats for every level beyond it.
const LOCK_DURATIONS_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

// A run of failures older than this is treated as unrelated to the current one:
// both the attempt counter and the escalation level start over.
export const ESCALATION_RESET_MS = 24 * 60 * 60 * 1000;

export type LoginAttemptState = {
  failedCount: number;
  lockLevel: number;
  lockedUntil: Date | null;
  lastFailedAt: Date | null;
};

export const CLEARED_ATTEMPT_STATE: LoginAttemptState = {
  failedCount: 0,
  lockLevel: 0,
  lockedUntil: null,
  lastFailedAt: null,
};

function lockDurationMs(lockLevel: number) {
  const index = Math.min(lockLevel, LOCK_DURATIONS_MS.length) - 1;
  return LOCK_DURATIONS_MS[Math.max(index, 0)];
}

function hasDecayed(state: LoginAttemptState, now: Date) {
  if (!state.lastFailedAt) return false;
  return now.getTime() - state.lastFailedAt.getTime() >= ESCALATION_RESET_MS;
}

/** Milliseconds left on an active lock; 0 when the email is not locked. */
export function lockRemainingMs(
  state: LoginAttemptState | null,
  now: Date,
): number {
  if (!state?.lockedUntil) return 0;
  return Math.max(0, state.lockedUntil.getTime() - now.getTime());
}

/**
 * Fold one failed sign-in into the stored state. Below the threshold this only
 * increments; at the threshold it arms the next rung of the ladder and clears
 * the counter, so the following lock is longer than this one.
 */
export function registerFailedAttempt(
  state: LoginAttemptState | null,
  now: Date,
): LoginAttemptState {
  const current =
    !state || hasDecayed(state, now) ? CLEARED_ATTEMPT_STATE : state;
  const failedCount = current.failedCount + 1;

  if (failedCount < MAX_FAILED_ATTEMPTS) {
    return { ...current, failedCount, lastFailedAt: now };
  }

  const lockLevel = current.lockLevel + 1;
  return {
    failedCount: 0,
    lockLevel,
    lockedUntil: new Date(now.getTime() + lockDurationMs(lockLevel)),
    lastFailedAt: now,
  };
}

/**
 * Human phrasing for the wait, rounded up. The sign-in page shows this
 * verbatim, so it deliberately says nothing about whether the account exists.
 */
export function describeLockRemaining(remainingMs: number): string {
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes <= 1) return "a minute";
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}
