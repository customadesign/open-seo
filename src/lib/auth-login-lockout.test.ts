import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoginLockoutPlugin } from "./auth-login-lockout";

const mocks = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  // Declared inside vi.hoisted so the hoisted vi.mock factory below can close
  // over it; a top-level class would not exist yet when the factory runs.
  FakeAPIError: class FakeAPIError extends Error {
    constructor(
      readonly code: string,
      options?: { message?: string },
    ) {
      super(options?.message ?? code);
    }
  },
}));

vi.mock("better-auth/api", () => ({
  APIError: mocks.FakeAPIError,
  createAuthMiddleware: <T>(handler: T) => handler,
}));

vi.mock("@/server/auth/repositories/LoginAttemptRepository", () => ({
  LoginAttemptRepository: {
    findByEmail: mocks.findByEmail,
    save: mocks.save,
    clear: mocks.clear,
  },
}));

const plugin = createLoginLockoutPlugin();
const before = plugin.hooks.before[0];
const after = plugin.hooks.after[0];

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused Better Auth hook context stub
const ctx = (body: unknown, returned?: unknown) =>
  ({ path: "/sign-in/email", body, context: { returned } }) as never;

describe("login lockout guard", () => {
  beforeEach(() => {
    mocks.findByEmail.mockResolvedValue(null);
  });

  it("only intercepts password sign-in, leaving the SSO handoff untouched", () => {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused Better Auth hook context stub
    const at = (path: string) => before.matcher({ path } as never);

    expect(at("/sign-in/email")).toBe(true);
    expect(at("/sso/onepagepm")).toBe(false);
    expect(at("/sign-in/social")).toBe(false);
  });

  it("refuses a locked email before the password is ever checked", async () => {
    mocks.findByEmail.mockResolvedValue({
      failedCount: 0,
      lockLevel: 1,
      lockedUntil: new Date(Date.now() + 10 * 60_000),
      lastFailedAt: new Date(),
    });

    await expect(
      before.handler(ctx({ email: "pat@murphyconsulting.us" })),
    ).rejects.toThrow(
      /Too many failed sign-in attempts\. Try again in 10 minutes\./,
    );
  });

  it("lets an expired lock through", async () => {
    mocks.findByEmail.mockResolvedValue({
      failedCount: 0,
      lockLevel: 1,
      lockedUntil: new Date(Date.now() - 1),
      lastFailedAt: new Date(),
    });

    await expect(
      before.handler(ctx({ email: "pat@murphyconsulting.us" })),
    ).resolves.toBeUndefined();
  });

  it("counts a rejected sign-in against the normalized email", async () => {
    await after.handler(
      ctx(
        { email: "  Pat@MurphyConsulting.us " },
        new mocks.FakeAPIError("UNAUTHORIZED"),
      ),
    );

    expect(mocks.save).toHaveBeenCalledWith(
      "pat@murphyconsulting.us",
      expect.objectContaining({ failedCount: 1, lockLevel: 0 }),
    );
  });

  it("clears the counter once a sign-in actually succeeds", async () => {
    await after.handler(
      ctx({ email: "pat@murphyconsulting.us" }, { user: { id: "u1" } }),
    );

    expect(mocks.clear).toHaveBeenCalledWith("pat@murphyconsulting.us");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("neither counts nor clears on a payload it does not recognise", async () => {
    // Guards the failure mode that matters: an unfamiliar shape must not be
    // read as a failure, or correct sign-ins would lock the account.
    await after.handler(
      ctx({ email: "pat@murphyconsulting.us" }, { redirect: true }),
    );

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
