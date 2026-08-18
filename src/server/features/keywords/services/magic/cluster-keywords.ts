/**
 * Keyword Magic clustering
 *
 * Deterministic topic grouping over keyword strings and optional SERP
 * feature overlap. No LLM, no embeddings, no paid SERP-URL fetch.
 *
 * Algorithm
 * 1. Normalize (lowercase, collapse whitespace) and tokenize on
 *    non-alphanumeric characters. Drop a small English stopword list and
 *    tokens of length 1.
 * 2. Extract candidate topic phrases: every 2-gram and 3-gram, plus each
 *    remaining content unigram.
 * 3. Score each phrase:
 *      score = df * length * (1 + ln(1 + totalVolume))
 *    Longer phrases rank first. Unigrams that cover more than 25% of the
 *    set are dropped (they are headings, not topics). Secondary key: SERP
 *    features shared by at least two members. Then lexicographic name.
 * 4. Greedy assign: walk phrases in that total order. A keyword joins the
 *    first phrase it contains as an ordered token subsequence, provided the
 *    phrase reaches MIN_SIZE members. MIN_SIZE is 3, or 2 when the input
 *    has fewer than 100 keywords.
 * 5. Leftovers attach to the highest-scoring unigram they contain that
 *    already has a cluster. Remaining singletons go to "Other".
 * 6. Cluster name = title-case of the winning phrase. Stable for the same
 *    input because scoring and assignment are total-ordered.
 * 7. Keep the top 50 clusters by member count (then name). Fold the rest
 *    into "Other".
 *
 * Limits
 * - English-centric stopwords; no stemming ("running" ≠ "run").
 * - SERP overlap is feature-type co-occurrence on a phrase, not URL overlap.
 *   Live SERP URLs are not fetched (that would re-bill per keyword).
 * - Not embedding-semantic: "cheap crm" and "affordable crm" stay apart
 *   unless they share tokens.
 */

import { KEYWORD_MAGIC_MAX_CLUSTERS } from "@/shared/keyword-magic";
import { tokenizeKeyword } from "./match-types";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

const OTHER_CLUSTER_NAME = "Other";

export type ClusterableKeyword = {
  keyword: string;
  searchVolume: number | null;
  serpFeatures?: readonly string[];
};

export type KeywordCluster = {
  name: string;
  keywords: string[];
};

export function clusterKeywords(
  rows: readonly ClusterableKeyword[],
): KeywordCluster[] {
  if (rows.length === 0) return [];

  const minSize = rows.length < 100 ? 2 : 3;
  const documents = rows.map(toDocument);
  const phrases = collectPhrases(documents);
  const ranked = rankPhrases(phrases, documents);

  const assigned = new Map<string, string>();
  for (const phrase of ranked) {
    const members = documents.filter(
      (doc) => !assigned.has(doc.keyword) && containsPhrase(doc.tokens, phrase),
    );
    if (members.length < minSize) continue;
    for (const member of members) {
      assigned.set(member.keyword, formatClusterName(phrase));
    }
  }

  const unigramByPhrase = new Map(
    ranked
      .filter((phrase) => phrase.length === 1)
      .map((phrase) => [phrase[0], formatClusterName(phrase)] as const),
  );
  for (const doc of documents) {
    if (assigned.has(doc.keyword)) continue;
    const host = doc.tokens.find((token) => {
      const name = unigramByPhrase.get(token);
      return name != null && [...assigned.values()].includes(name);
    });
    if (host) assigned.set(doc.keyword, formatClusterName([host]));
  }

  const groups = new Map<string, string[]>();
  for (const doc of documents) {
    const name = assigned.get(doc.keyword) ?? OTHER_CLUSTER_NAME;
    const group = groups.get(name) ?? [];
    group.push(doc.keyword);
    groups.set(name, group);
  }

  const named = [...groups.entries()]
    .filter(([name]) => name !== OTHER_CLUSTER_NAME)
    .map(([name, keywords]) => ({ name, keywords }))
    .toSorted(compareClusters);

  const kept = named.slice(0, KEYWORD_MAGIC_MAX_CLUSTERS);
  const folded = named
    .slice(KEYWORD_MAGIC_MAX_CLUSTERS)
    .flatMap((c) => c.keywords);
  const other = [...(groups.get(OTHER_CLUSTER_NAME) ?? []), ...folded].toSorted(
    (a, b) => a.localeCompare(b),
  );

  if (other.length === 0) return kept;
  return [...kept, { name: OTHER_CLUSTER_NAME, keywords: other }];
}

type Document = {
  keyword: string;
  tokens: string[];
  volume: number;
  serpFeatures: readonly string[];
};

function toDocument(row: ClusterableKeyword): Document {
  const tokens = tokenizeKeyword(row.keyword).filter(
    (token) => token.length > 1 && !STOPWORDS.has(token),
  );
  return {
    keyword: row.keyword,
    tokens,
    volume: row.searchVolume ?? 0,
    serpFeatures: row.serpFeatures ?? [],
  };
}

function collectPhrases(documents: readonly Document[]): string[][] {
  const seen = new Set<string>();
  const phrases: string[][] = [];
  for (const doc of documents) {
    for (const phrase of phrasesOf(doc.tokens)) {
      const key = phrase.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push(phrase);
    }
  }
  return phrases;
}

function phrasesOf(tokens: readonly string[]): string[][] {
  const phrases: string[][] = [];
  for (const token of tokens) phrases.push([token]);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push([tokens[index], tokens[index + 1]]);
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    phrases.push([tokens[index], tokens[index + 1], tokens[index + 2]]);
  }
  return phrases;
}

function rankPhrases(
  phrases: readonly string[][],
  documents: readonly Document[],
): string[][] {
  const corpusSize = Math.max(1, documents.length);
  return phrases
    .map((phrase) => {
      const members = documents.filter((doc) =>
        containsPhrase(doc.tokens, phrase),
      );
      const df = members.length;
      const totalVolume = members.reduce((sum, doc) => sum + doc.volume, 0);
      const score = df * phrase.length * (1 + Math.log1p(totalVolume));
      return {
        phrase,
        score,
        df,
        sharedSerpFeatures: countSharedSerpFeatures(members),
        name: phrase.join(" "),
      };
    })
    .filter((entry) => {
      // Unigrams that cover a large slice of the set are headings, not topics.
      if (entry.phrase.length === 1 && entry.df / corpusSize > 0.25) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => {
      if (right.phrase.length !== left.phrase.length) {
        return right.phrase.length - left.phrase.length;
      }
      if (right.score !== left.score) return right.score - left.score;
      if (right.sharedSerpFeatures !== left.sharedSerpFeatures) {
        return right.sharedSerpFeatures - left.sharedSerpFeatures;
      }
      return left.name.localeCompare(right.name);
    })
    .map((entry) => entry.phrase);
}

function countSharedSerpFeatures(members: readonly Document[]): number {
  const counts = new Map<string, number>();
  for (const member of members) {
    for (const feature of new Set(member.serpFeatures)) {
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
    }
  }
  let shared = 0;
  for (const count of counts.values()) {
    if (count >= 2) shared += 1;
  }
  return shared;
}

function containsPhrase(
  tokens: readonly string[],
  phrase: readonly string[],
): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    let matches = true;
    for (let index = 0; index < phrase.length; index += 1) {
      if (tokens[start + index] !== phrase[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

export function formatClusterName(phrase: readonly string[]): string {
  return phrase
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function compareClusters(left: KeywordCluster, right: KeywordCluster): number {
  if (right.keywords.length !== left.keywords.length) {
    return right.keywords.length - left.keywords.length;
  }
  return left.name.localeCompare(right.name);
}
