import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authLoginAttempt } from "@/db/schema";
import type { LoginAttemptState } from "@/lib/auth-lockout";

async function findByEmail(email: string): Promise<LoginAttemptState | null> {
  const row = await db.query.authLoginAttempt.findFirst({
    where: eq(authLoginAttempt.email, email),
  });
  if (!row) return null;

  return {
    failedCount: row.failedCount,
    lockLevel: row.lockLevel,
    lockedUntil: row.lockedUntil,
    lastFailedAt: row.lastFailedAt,
  };
}

async function save(email: string, state: LoginAttemptState) {
  const values = {
    failedCount: state.failedCount,
    lockLevel: state.lockLevel,
    lockedUntil: state.lockedUntil,
    lastFailedAt: state.lastFailedAt ?? new Date(),
  };

  await db
    .insert(authLoginAttempt)
    .values({ email, ...values })
    .onConflictDoUpdate({ target: authLoginAttempt.email, set: values });
}

async function clear(email: string) {
  await db.delete(authLoginAttempt).where(eq(authLoginAttempt.email, email));
}

export const LoginAttemptRepository = {
  findByEmail,
  save,
  clear,
} as const;
