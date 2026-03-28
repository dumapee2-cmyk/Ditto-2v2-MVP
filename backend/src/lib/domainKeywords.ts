/**
 * Domain keyword extraction and normalization utilities.
 * Used by the quality scorer to check if generated code matches the user's prompt domain.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "is", "it", "that", "this", "are", "was", "be", "have",
  "do", "make", "build", "create", "app", "application", "tool", "page", "website",
  "web", "simple", "basic", "good", "great", "nice", "cool", "awesome", "beautiful",
  "modern", "clean", "professional", "premium", "like", "want", "need", "please",
  "can", "could", "would", "should", "will", "just", "also", "very", "really",
  "my", "me", "i", "you", "we", "our", "your", "its", "use", "using", "used",
]);

/**
 * Extract meaningful domain keywords from a user's prompt.
 * Filters out stop words and returns unique, lowercased terms.
 */
export function extractDomainKeywordsFromPrompt(
  prompt: string,
  opts?: { max?: number },
): string[] {
  const max = opts?.max ?? 12;
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Also extract multi-word phrases (bigrams)
  const tokens = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = `${tokens[i]} ${tokens[i + 1]}`;
    if (!STOP_WORDS.has(tokens[i]) && !STOP_WORDS.has(tokens[i + 1]) && tokens[i].length > 2 && tokens[i + 1].length > 2) {
      bigrams.push(bi);
    }
  }

  const unique = [...new Set([...bigrams, ...words])];
  return unique.slice(0, max);
}

/**
 * Normalize an array of domain keywords: lowercase, deduplicate, trim, limit.
 */
export function normalizeDomainKeywords(
  keywords: string[],
  opts?: { max?: number },
): string[] {
  const max = opts?.max ?? 15;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of keywords) {
    const normalized = kw.toLowerCase().trim();
    if (normalized.length > 1 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result.slice(0, max);
}

/**
 * Check if a keyword appears in text, handling both single words and multi-word phrases.
 * Uses word boundary matching for single words, substring for phrases.
 */
export function keywordAppearsInText(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  const t = text.toLowerCase();
  if (kw.includes(" ")) {
    // Multi-word phrase: check substring
    return t.includes(kw);
  }
  // Single word: check word boundary
  const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return regex.test(t);
}
