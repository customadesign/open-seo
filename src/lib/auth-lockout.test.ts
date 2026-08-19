import { describe, expect, it } from "vitest";
import {
  CLEARED_ATTEMPT_STATE,
  ESCALATION_RESET_MS,
  describeLockRemaining,
  lockRemainingMs,
  registerFailedAttempt,
} from "@/lib/auth-lockout";

const START = new Date("2026-08-20T00:00:00.000Z");
const at = (ms: number) => new Date(START.getTime() + ms);
const MINUTE = 60_000;

/** Drive `count` consecutive failures, one second apart, from `state`. */
function fail(count: number, state = CLEARED_ATTEMPT_STATE, from = START) {
  let current = state;
  for (let i = 0; i < count; i++) {
    current = registerFailedAttempt(
      current,
      new Date(from.getTime() + i * 1000),
    );
  }
  return current;
}

describe("registerFailedAttempt", () => {
  it("does not lock before the third failure", () => {
    const state = fail(2);

    expect(state.lockedUntil).toBeNull();
    expect(lockRemainingMs(state, START)).toBe(0);
  });

  it("locks for 15 minutes on the third failure", () => {
    const state = fail(3);

    expect(state.lockLevel).toBe(1);
    expect(lockRemainingMs(state, at(14 * MINUTE))).toBeGreaterThan(0);
    expect(lockRemainingMs(state, at(16 * MINUTE))).toBe(0);
  });

  it("escalates to an hour, then a day, on later locks", () => {
    const first = fail(3);
    const second = fail(3, first, at(20 * MINUTE));
    const third = fail(3, second, at(2 * 60 * MINUTE));

    expect(lockRemainingMs(second, at(80 * MINUTE))).toBeGreaterThan(0);
    expect(lockRemainingMs(second, at(140 * MINUTE))).toBe(0);
    expect(third.lockLevel).toBe(3);
    expect(lockRemainingMs(third, at(25 * 60 * MINUTE))).toBeGreaterThan(0);
  });

  it("stays at a day rather than growing without bound", () => {
    let state = fail(3);
    for (let round = 1; round <= 5; round++) {
      state = fail(3, state, at(round * 60 * MINUTE));
    }

    // Level keeps counting, but the wait is clamped to the last rung.
    expect(state.lockLevel).toBe(6);
    expect(
      lockRemainingMs(
        state,
        new Date(state.lastFailedAt!.getTime() + 25 * 60 * MINUTE),
      ),
    ).toBe(0);
  });

  it("forgets the ladder after a clean day", () => {
    const locked = fail(3);
    const later = at(ESCALATION_RESET_MS + MINUTE);

    // A single failure a day later must not re-lock: the run starts over.
    const state = registerFailedAttempt(locked, later);
    expect(state.lockLevel).toBe(0);
    expect(state.failedCount).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });

  it("counts a first failure against an email it has never seen", () => {
    const state = registerFailedAttempt(null, START);

    expect(state.failedCount).toBe(1);
  });
});

describe("describeLockRemaining", () => {
  it("rounds up so the message never expires early", () => {
    expect(describeLockRemaining(14.2 * MINUTE)).toBe("15 minutes");
    expect(describeLockRemaining(59 * MINUTE)).toBe("59 minutes");
    expect(describeLockRemaining(60 * MINUTE)).toBe("an hour");
    expect(describeLockRemaining(23.5 * 60 * MINUTE)).toBe("24 hours");
  });
});
