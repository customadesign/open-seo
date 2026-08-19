import type { KeywordMagicMatchType } from "@/shared/keyword-magic";

const QUESTION_STARTERS = new Set([
  "who",
  "what",
  "where",
  "when",
  "why",
  "how",
  "which",
  "whom",
  "whose",
  "can",
  "could",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "will",
  "would",
  "should",
  "shall",
  "may",
  "might",
]);

/** Lowercase alphanumeric tokens; hyphens/punctuation become splits. */
export function tokenizeKeyword(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

export function keywordWordCount(value: string): number {
  return tokenizeKeyword(value).length;
}

function containsContiguousSequence(
  haystack: string[],
  needle: string[],
): boolean {
  if (needle.length === 0) return false;
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matches = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function tokensEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((token, index) => token === right[index]);
}

/**
 * Broad Match: every seed token appears in the keyword, in any order.
 * See KEYWORD_MAGIC_MATCH_TYPES in src/shared/keyword-magic.ts.
 */
export function isBroadMatch(keyword: string, seed: string): boolean {
  const seedTokens = tokenizeKeyword(seed);
  if (seedTokens.length === 0) return false;
  const keywordTokens = new Set(tokenizeKeyword(keyword));
  return seedTokens.every((token) => keywordTokens.has(token));
}

/**
 * Phrase Match: the seed appears as a contiguous token sequence.
 * See KEYWORD_MAGIC_MATCH_TYPES in src/shared/keyword-magic.ts.
 */
export function isPhraseMatch(keyword: string, seed: string): boolean {
  return containsContiguousSequence(
    tokenizeKeyword(keyword),
    tokenizeKeyword(seed),
  );
}

/**
 * Exact Match: keyword tokens equal seed tokens (punctuation-insensitive).
 * See KEYWORD_MAGIC_MATCH_TYPES in src/shared/keyword-magic.ts.
 */
export function isExactMatch(keyword: string, seed: string): boolean {
  return tokensEqual(tokenizeKeyword(keyword), tokenizeKeyword(seed));
}

/**
 * Related: the keyword is not a Broad Match of the seed.
 * See KEYWORD_MAGIC_MATCH_TYPES in src/shared/keyword-magic.ts.
 */
export function isRelatedMatch(keyword: string, seed: string): boolean {
  return !isBroadMatch(keyword, seed);
}

/**
 * Questions: contains "?" or starts with a question word.
 * See KEYWORD_MAGIC_MATCH_TYPES in src/shared/keyword-magic.ts.
 */
export function isQuestionKeyword(keyword: string): boolean {
  if (keyword.includes("?")) return true;
  const first = tokenizeKeyword(keyword)[0];
  return first != null && QUESTION_STARTERS.has(first);
}

export function matchesKeywordMagicType(
  keyword: string,
  seed: string,
  matchType: KeywordMagicMatchType,
): boolean {
  switch (matchType) {
    case "all":
      return true;
    case "broad":
      return isBroadMatch(keyword, seed);
    case "phrase":
      return isPhraseMatch(keyword, seed);
    case "exact":
      return isExactMatch(keyword, seed);
    case "related":
      return isRelatedMatch(keyword, seed);
    case "questions":
      return isQuestionKeyword(keyword);
  }
}
