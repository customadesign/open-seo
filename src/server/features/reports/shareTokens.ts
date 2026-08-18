type ShareLinkState = {
  expiresAt: string;
  revokedAt: string | null;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
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
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(bytes);
  return { token, tokenHash: await hashReportShareToken(token) };
}

export function isReportShareLinkUsable(
  link: ShareLinkState,
  now: Date,
): boolean {
  if (link.revokedAt !== null) return false;
  const expiresAt = Date.parse(link.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}
