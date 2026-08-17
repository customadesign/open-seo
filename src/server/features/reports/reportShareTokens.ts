// Share tokens are bearer credentials for a client-readable report. They are
// generated from 32 CSPRNG bytes and only ever stored as a SHA-256 hash, so a
// database dump cannot be replayed against the public share endpoint.
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashReportShareToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createReportShareToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { token, tokenHash: await hashReportShareToken(token) };
}

export function isReportShareLinkUsable(
  link: { expiresAt: string; revokedAt: string | null },
  now: Date,
): boolean {
  if (link.revokedAt !== null) return false;
  const expiresAt = Date.parse(link.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}
