/**
 * Lightweight web search — finds real product URLs and descriptions
 * by scraping Brave Search HTML results. No API key needed.
 *
 * Used when a user says "make an app like Ditto AI" and we need to
 * discover what Ditto AI actually is and find its real website.
 *
 * Also exports `extractAppCategory()` — a logic pipeline that reads
 * the web search description to figure out the app's domain (dating,
 * finance, fitness, etc.) so downstream searches (Figma, 21st.dev)
 * know what to look for.
 */

import { braveSearch } from "./braveSearch.js";
import { tavily } from "@tavily/core";

// ─── Tavily-powered search (richer results, requires API key) ───

let _tavilyClient: ReturnType<typeof tavily> | null = null;

function getTavilyClient(): ReturnType<typeof tavily> | null {
  if (_tavilyClient) return _tavilyClient;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  _tavilyClient = tavily({ apiKey });
  return _tavilyClient;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

/**
 * Rich web search via Tavily. Falls back to Brave if Tavily is not configured.
 * Used during generation for current info, docs, real-world context.
 */
export async function richSearch(
  query: string,
  options?: { maxResults?: number; includeImages?: boolean; searchDepth?: "basic" | "advanced"; includeDomains?: string[] },
): Promise<{ results: TavilySearchResult[]; images: string[] }> {
  const client = getTavilyClient();
  if (!client) {
    // Fallback to Brave
    const braveResults = await searchForProduct(query);
    return {
      results: braveResults.results.map(r => ({ title: r.title, url: r.url, content: r.snippet, score: 0.5 })),
      images: [],
    };
  }

  try {
    const response = await client.search(query, {
      maxResults: options?.maxResults ?? 5,
      searchDepth: options?.searchDepth ?? "basic",
      includeImages: options?.includeImages ?? false,
      includeDomains: options?.includeDomains,
    });

    const results: TavilySearchResult[] = (response.results ?? []).map((r: Record<string, unknown>) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      content: String(r.content ?? ""),
      score: Number(r.score ?? 0),
    }));

    const images: string[] = (response.images ?? []).map((img: unknown) =>
      typeof img === "string" ? img : String((img as Record<string, unknown>).url ?? img),
    );

    return { results, images };
  } catch (err) {
    console.error(`[richSearch] Tavily failed for "${query}", falling back to Brave:`, err instanceof Error ? err.message : err);
    const braveResults = await searchForProduct(query);
    return {
      results: braveResults.results.map(r => ({ title: r.title, url: r.url, content: r.snippet, score: 0.5 })),
      images: [],
    };
  }
}

/**
 * Search specifically for technical documentation.
 */
export async function searchDocs(query: string): Promise<TavilySearchResult[]> {
  const result = await richSearch(query, {
    maxResults: 3,
    searchDepth: "advanced",
    includeDomains: ["docs.supabase.com", "developer.mozilla.org", "react.dev", "tailwindcss.com", "ui.shadcn.com"],
  });
  return result.results;
}

/**
 * Search for images related to a topic.
 */
export async function searchImages(query: string, maxResults = 5): Promise<string[]> {
  const result = await richSearch(query, { maxResults, includeImages: true });
  return result.images;
}

export function isRichSearchAvailable(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ProductSearchResult {
  /** Best guess for the product's actual URL */
  url: string | null;
  /** Short description of what the product is */
  description: string;
  /** All search results */
  results: SearchResult[];
}

// ─── Brave Search HTML parser ───────────────────────────────────

function parseBraveResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Brave snippet blocks: <div class="snippet svelte-..." data-pos="N" data-type="web">
  const snippetPattern = /<div class="snippet\s+svelte-[^"]*"\s+data-pos="\d+"\s+data-type="web"[^>]*>([\s\S]*?)(?=<div class="snippet\s|<\/main>|$)/gi;
  let snippetMatch;

  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    const block = snippetMatch[1];

    // URL: <a href="URL" class="...l1">
    const urlMatch = block.match(/<a href="(https?:\/\/[^"]+)"[^>]*class="[^"]*l1"/);
    if (!urlMatch) continue;
    const url = urlMatch[1];

    // Title: class="title..."
    const titleMatch = block.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim()
      : "";

    // Description: class="content..."
    const descMatch = block.match(/class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const snippet = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim()
      : "";

    if (url && title) {
      results.push({ url, title, snippet });
    }
    if (results.length >= 8) break;
  }

  // Fallback: simple anchor extraction
  if (results.length === 0) {
    const simplePattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set<string>();
    let match;
    while ((match = simplePattern.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      if (
        url && title && title.length > 5 &&
        !url.includes("brave.com") &&
        !url.includes("javascript:") &&
        !seen.has(url)
      ) {
        seen.add(url);
        results.push({ url, title, snippet: "" });
        if (results.length >= 6) break;
      }
    }
  }

  return results;
}

/**
 * Domains to skip — these are aggregator/social sites, not the product itself.
 */
const SKIP_DOMAINS = [
  "youtube.com", "twitter.com", "x.com", "facebook.com",
  "reddit.com", "linkedin.com", "instagram.com", "tiktok.com",
  "wikipedia.org", "amazon.com", "pinterest.com",
  "crunchbase.com", "g2.com", "capterra.com",
  "producthunt.com", "techcrunch.com",
];

function isProductDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return !SKIP_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}

/**
 * Search the web for a product name and find its real URL + description.
 * Uses Brave Search HTML (no API key needed).
 */
export async function searchForProduct(productName: string): Promise<ProductSearchResult> {
  try {
    const html = await braveSearch(`${productName} app official website`);
    const results = parseBraveResults(html);

    if (results.length === 0) {
      console.warn(`Web search returned no results for "${productName}"`);
      return { url: null, description: "", results: [] };
    }

    // Find the best URL — prefer the product's own domain
    const productResult = results.find(r => isProductDomain(r.url));
    const bestUrl = productResult?.url ?? results[0].url;

    // Build a description from the top snippets
    const topSnippets = results
      .slice(0, 3)
      .map(r => r.snippet)
      .filter(s => s.length > 10);
    const description = topSnippets.join(" ").slice(0, 500);

    console.log(`Web search for "${productName}": found ${results.length} results, best URL: ${bestUrl}`);

    return {
      url: bestUrl,
      description,
      results,
    };
  } catch (e) {
    console.warn(`Web search failed for "${productName}":`, e instanceof Error ? e.message : e);
    return { url: null, description: "", results: [] };
  }
}

// ─── Parked domain detection ────────────────────────────────────

const PARKED_SIGNALS = [
  "for sale", "is for sale", "buy this domain", "domain is available",
  "hugedomains", "godaddy", "sedo.com", "afternic", "dan.com",
  "domain parking", "parked domain", "this domain may be for sale",
  "get your very own domain", "register this domain", "domain auction",
  "namecheap marketplace", "domain broker",
];

/**
 * Detect if a site summary indicates a parked/for-sale domain.
 * These are useless as product references — they tell us nothing
 * about what the product actually is.
 */
export function isParkedDomain(siteSummary: string): boolean {
  if (!siteSummary) return false;
  const lower = siteSummary.toLowerCase();
  return PARKED_SIGNALS.some(signal => lower.includes(signal));
}

/**
 * Also try fetching the homepage meta description and title.
 * Returns a short summary of what the site is about.
 */
export async function fetchSiteSummary(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; Bit7/1.0)" }, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return "";

    const html = (await res.text()).slice(0, 50000);

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 100) ?? "";

    // Extract meta description
    const descMatch = html.match(/<meta\s+(?:name|property)="(?:description|og:description)"\s+content="([^"]+)"/i)
      ?? html.match(/content="([^"]+)"\s+(?:name|property)="(?:description|og:description)"/i);
    const desc = descMatch?.[1]?.slice(0, 300) ?? "";

    // Extract og:title for more context
    const ogTitleMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i)
      ?? html.match(/content="([^"]+)"\s+(?:property|name)="og:title"/i);
    const ogTitle = ogTitleMatch?.[1]?.slice(0, 100) ?? "";

    const parts = [title, ogTitle, desc].filter(Boolean);
    return parts.join(" — ").slice(0, 500);
  } catch {
    return "";
  }
}

// ─── Logic Pipeline: Extract App Category from Web Search Data ──

/**
 * Domain signal words — found in web search descriptions, site summaries,
 * and snippets. These are DESCRIPTION words (what the product does),
 * NOT product names.
 *
 * Example: web search for "Ditto AI" returns description containing
 * "dating", "match", "relationship" → category = "dating"
 */
const CATEGORY_DOMAIN_SIGNALS: Record<string, string[]> = {
  dating: ["dating", "date", "match", "matchmaking", "relationship", "singles", "romance", "romantic", "couples", "love", "swipe"],
  social: ["social media", "social network", "feed", "followers", "posts", "sharing", "community platform", "stories", "timeline"],
  chat: ["messaging", "chat", "instant message", "real-time communication", "conversations", "direct message"],
  ecommerce: ["shopping", "ecommerce", "e-commerce", "online store", "marketplace", "products", "buy", "sell", "retail", "checkout", "cart"],
  fitness: ["fitness", "workout", "exercise", "gym", "training", "health tracking", "calories", "steps", "running", "athletic"],
  food: ["food delivery", "restaurant", "recipe", "meal", "cooking", "food ordering", "menu", "ingredients", "dining"],
  finance: ["banking", "finance", "fintech", "payments", "investing", "budget", "money management", "wallet", "trading", "stocks", "crypto"],
  productivity: ["productivity", "task management", "project management", "to-do", "kanban", "workflow", "organizer", "notes", "collaboration"],
  education: ["education", "learning", "courses", "e-learning", "tutoring", "students", "teaching", "quiz", "study"],
  travel: ["travel", "booking", "hotel", "flights", "vacation", "accommodation", "trip planning", "itinerary", "tourism"],
  music: ["music", "streaming", "playlist", "audio", "podcast", "songs", "artist", "listening"],
  dashboard: ["dashboard", "analytics", "reporting", "metrics", "data visualization", "admin panel", "monitoring"],
  realestate: ["real estate", "property", "rental", "apartment", "house", "listing", "mortgage", "realtor"],
  scheduling: ["scheduling", "calendar", "appointments", "booking", "availability", "meeting", "agenda", "time management", "automated scheduling"],
  medical: ["healthcare", "medical", "telemedicine", "patient", "doctor", "clinical", "health records", "diagnosis", "prescription"],
  news: ["news", "journalism", "articles", "media", "headlines", "newsletter", "blog", "publishing"],
  gaming: ["gaming", "game", "esports", "multiplayer", "leaderboard", "tournament"],
  portfolio: ["portfolio", "personal website", "landing page", "showcase"],
  crm: ["crm", "customer relationship", "sales pipeline", "leads", "contacts", "deals"],
  weather: ["weather", "forecast", "climate", "meteorological"],
};

/**
 * Extract the app category from web search intelligence.
 *
 * This is the "logic pipeline" the system uses to figure out what kind of
 * app the user wants. Instead of matching hardcoded product names against
 * the raw prompt, we read the web search description + site summary to
 * understand what the product actually IS.
 *
 * Example flow:
 *   prompt: "make me an app like Ditto AI"
 *   web search finds: "Ditto is an AI-powered dating app..."
 *   → extractAppCategory returns "dating"
 *   → Figma search queries become "dating app mobile"
 *   → 21st.dev queries become "card hover", "hero gradient"
 *
 * @param searchDescription - combined text from web search snippets + site summary
 * @returns the detected category string, or null if no strong signal
 */
export function extractAppCategory(searchDescription: string): string | null {
  if (!searchDescription || searchDescription.length < 10) return null;

  const lower = searchDescription.toLowerCase();
  let bestCategory: string | null = null;
  let bestScore = 0;

  for (const [category, signals] of Object.entries(CATEGORY_DOMAIN_SIGNALS)) {
    let score = 0;
    for (const signal of signals) {
      // Count occurrences — more mentions = stronger signal
      const idx = lower.indexOf(signal);
      if (idx !== -1) {
        score += signal.includes(" ") ? 3 : 2; // multi-word signals are more specific
        // Check for a second occurrence
        if (lower.indexOf(signal, idx + signal.length) !== -1) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestCategory && bestScore >= 2) {
    console.log(`[Web Search] Extracted app category "${bestCategory}" from description (score: ${bestScore})`);
    return bestCategory;
  }

  console.log(`[Web Search] No strong category signal from description (best: ${bestCategory ?? "none"}, score: ${bestScore})`);
  return null;
}
