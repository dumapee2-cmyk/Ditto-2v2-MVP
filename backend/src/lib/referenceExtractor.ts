/**
 * Reference Extractor — detects URLs and "like [website/product]" patterns
 * in user prompts, resolves them to scrapeable URLs.
 */

export interface ExtractedReference {
  /** The original text matched (e.g. "Cal AI", "spotify.com", "https://linear.app") */
  raw: string;
  /** Resolved full URL to scrape */
  url: string;
  /** Whether the user provided an explicit URL vs a product name */
  isExplicitUrl: boolean;
}

/**
 * Well-known product → URL mappings for products whose URLs don't match
 * a simple "{name}.com" pattern.
 */
const KNOWN_PRODUCTS: Record<string, string> = {
  "cal ai": "https://www.cal.ai",
  "cal.ai": "https://www.cal.ai",
  "chatgpt": "https://chat.openai.com",
  "chat gpt": "https://chat.openai.com",
  "perplexity": "https://www.perplexity.ai",
  "perplexity ai": "https://www.perplexity.ai",
  "linear": "https://linear.app",
  "vercel": "https://vercel.com",
  "v0": "https://v0.dev",
  "v0.dev": "https://v0.dev",
  "midjourney": "https://www.midjourney.com",
  "cursor": "https://cursor.sh",
  "replit": "https://replit.com",
  "supabase": "https://supabase.com",
  "stripe": "https://stripe.com",
  "arc browser": "https://arc.net",
  "arc": "https://arc.net",
  "raycast": "https://www.raycast.com",
  "todoist": "https://todoist.com",
  "superhuman": "https://superhuman.com",
  "loom": "https://www.loom.com",
  "framer": "https://www.framer.com",
  "webflow": "https://webflow.com",
  "airtable": "https://airtable.com",
  "coda": "https://coda.io",
  "retool": "https://retool.com",
  "base44": "https://base44.com",
};

/**
 * Patterns that indicate a reference to a specific product/website:
 * - "like X"
 * - "similar to X"
 * - "clone of X"
 * - "inspired by X"
 * - "based on X"
 */
const REFERENCE_PATTERNS = [
  /\blike\s+([A-Z][A-Za-z0-9. ]{1,40}?)(?:\s*[,.\-!?]|\s+(?:but|with|and|for|that|where|which|app|website|site|platform)\b|$)/i,
  /\bsimilar\s+to\s+([A-Z][A-Za-z0-9. ]{1,40}?)(?:\s*[,.\-!?]|\s+(?:but|with|and|for|that|where|which|app|website|site|platform)\b|$)/i,
  /\bclone\s+(?:of\s+)?([A-Z][A-Za-z0-9. ]{1,40}?)(?:\s*[,.\-!?]|\s+(?:but|with|and|for|that|where|which)\b|$)/i,
  /\binspired\s+by\s+([A-Z][A-Za-z0-9. ]{1,40}?)(?:\s*[,.\-!?]|\s+(?:but|with|and|for|that|where|which)\b|$)/i,
  /\bbased\s+on\s+([A-Z][A-Za-z0-9. ]{1,40}?)(?:\s*[,.\-!?]|\s+(?:but|with|and|for|that|where|which)\b|$)/i,
];

/** Match explicit URLs in the prompt */
const URL_PATTERN = /https?:\/\/[^\s,)]+/gi;

/** Match domain-like patterns: "word.com", "word.io", "word.app", etc. */
const DOMAIN_PATTERN = /\b([a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com|io|app|dev|ai|co|net|org|sh|xyz|me))\b/gi;

function resolveProductToUrl(name: string): string {
  const lower = name.toLowerCase().trim();

  // Check known products first
  if (KNOWN_PRODUCTS[lower]) {
    return KNOWN_PRODUCTS[lower];
  }

  // If it looks like a domain already (has a TLD)
  if (/\.[a-z]{2,6}$/i.test(lower)) {
    return `https://${lower}`;
  }

  // Default: try {clean-name}.com
  const clean = lower.replace(/[^a-z0-9]/g, "");
  return `https://${clean}.com`;
}

/**
 * Extract referenced websites/products from a user prompt.
 * Returns all detected references, with explicit URLs first.
 */
export function extractReferences(prompt: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];
  const seenUrls = new Set<string>();

  // 1. Explicit URLs (highest priority)
  const urlMatches = prompt.match(URL_PATTERN) ?? [];
  for (const url of urlMatches) {
    const cleaned = url.replace(/[.),;!?]+$/, ""); // strip trailing punctuation
    if (!seenUrls.has(cleaned)) {
      seenUrls.add(cleaned);
      refs.push({ raw: cleaned, url: cleaned, isExplicitUrl: true });
    }
  }

  // 2. Domain patterns like "spotify.com", "linear.app"
  const domainMatches = [...prompt.matchAll(DOMAIN_PATTERN)];
  for (const match of domainMatches) {
    const domain = match[1];
    const url = `https://${domain}`;
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      refs.push({ raw: domain, url, isExplicitUrl: true });
    }
  }

  // 3. "Like [Product Name]" patterns
  for (const pattern of REFERENCE_PATTERNS) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      const productName = match[1].trim().replace(/\s+/g, " ");
      // Skip generic words that aren't product names
      if (/^(a|an|the|this|that|my|our|your|its|some|any)$/i.test(productName)) continue;
      if (productName.length < 2) continue;

      const url = resolveProductToUrl(productName);
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        refs.push({ raw: productName, url, isExplicitUrl: false });
      }
    }
  }

  return refs;
}
