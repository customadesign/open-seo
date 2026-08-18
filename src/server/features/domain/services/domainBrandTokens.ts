import { parse as parseTld } from "tldts";

/**
 * Branded-keyword rule (explicit, not guessed):
 * 1. Derived tokens come from the registrable second-level label
 *    (example.com → "example"). Hyphenated labels also add each part
 *    that is at least 3 characters (open-seo → "open-seo", "open", "seo").
 * 2. User tokens are stored lowercase per project + domain and can be
 *    added or removed. Derived tokens are never stored.
 * 3. A keyword is branded when any token equals a word after splitting
 *    on non-alphanumerics, or consecutive words collapse to the token
 *    (so "open seo tool" matches "openseo", but "examples" does not
 *    match "example").
 */
export function deriveBrandTokensFromDomain(domain: string): string[] {
  const parsed = parseTld(domain, { allowPrivateDomains: true });
  const label = parsed.domainWithoutSuffix?.toLowerCase().trim();
  if (!label) return [];

  const tokens = new Set<string>([label]);
  for (const part of label.split("-")) {
    if (part.length >= 3) tokens.add(part);
  }
  return [...tokens].toSorted();
}

export function normalizeBrandToken(value: string): string | null {
  const token = value.toLowerCase().trim().replace(/\s+/g, " ");
  if (token.length < 2 || token.length > 64) return null;
  if (!/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/.test(token)) return null;
  return token;
}

export function keywordMatchesBrandToken(
  keyword: string,
  token: string,
): boolean {
  const normalizedToken = token.toLowerCase().trim();
  if (!normalizedToken) return false;

  const words = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const collapsedToken = normalizedToken.replace(/[^a-z0-9]+/g, "");
  if (words.includes(normalizedToken) || words.includes(collapsedToken)) {
    return true;
  }
  if (collapsedToken.length < 3) return false;

  for (let start = 0; start < words.length; start += 1) {
    let acc = "";
    for (let end = start; end < words.length; end += 1) {
      acc += words[end];
      if (acc === collapsedToken) return true;
      if (acc.length > collapsedToken.length) break;
    }
  }
  return false;
}

export function isBrandedKeyword(keyword: string, tokens: string[]): boolean {
  return tokens.some((token) => keywordMatchesBrandToken(keyword, token));
}
