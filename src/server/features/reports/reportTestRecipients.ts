import { getOptionalEnvValue } from "@/server/lib/runtime-env";

type ReportDeliveryGuard = {
  /** When on, only allowlisted addresses receive mail; everything else is
   * recorded as skipped instead of sent. On unless a deployment explicitly
   * turns it off, so an unconfigured environment can never mail a client. */
  testMode: boolean;
  allowlist: Set<string>;
};

export function parseRecipientAllowlist(
  value: string | undefined,
): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes("@")),
  );
}

/**
 * Fail closed: only the exact string "false" turns test mode off. A missing,
 * empty, misspelled or truthy value keeps delivery restricted to the
 * allowlist, so a deployment that configures Resend without deciding about
 * client delivery cannot start mailing clients by omission.
 */
export function parseDeliveryTestMode(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

export async function loadReportDeliveryGuard(): Promise<ReportDeliveryGuard> {
  const [testMode, allowlist] = await Promise.all([
    getOptionalEnvValue("REPORT_DELIVERY_TEST_MODE"),
    getOptionalEnvValue("REPORT_TEST_RECIPIENTS"),
  ]);
  return {
    testMode: parseDeliveryTestMode(testMode),
    allowlist: parseRecipientAllowlist(allowlist),
  };
}

export function isScheduledRecipientAllowed(
  email: string,
  guard: ReportDeliveryGuard,
): boolean {
  if (!guard.testMode) return true;
  return guard.allowlist.has(email.trim().toLowerCase());
}

/**
 * A manual "send me a copy" must never reach a client address by accident, so
 * it is limited to the operator allowlist or the requester's own account
 * address — regardless of whether test mode is on.
 */
export function isTestRecipientAllowed(input: {
  email: string;
  requesterEmail: string | null;
  guard: ReportDeliveryGuard;
}): boolean {
  const email = input.email.trim().toLowerCase();
  if (input.guard.allowlist.has(email)) return true;
  return input.requesterEmail?.trim().toLowerCase() === email;
}
