/**
 * Centralized Brave Search via the official API.
 * Requires BRAVE_SEARCH_API_KEY env var (free tier: 2,000 queries/month).
 * In-memory caching (1hr TTL) and rate limiting (0.5s between requests).
 */

// ─── In-memory cache ────────────────────────────────────────────

interface CacheEntry {
  html: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 3_600_000; // 1 hour

function getCached(query: string): string | null {
  const entry = cache.get(query);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(query);
    return null;
  }
  return entry.html;
}

function setCache(query: string, html: string): void {
  cache.set(query, { html, timestamp: Date.now() });
  if (cache.size > 100) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 20);
    for (const [key] of oldest) cache.delete(key);
  }
}

// ─── Rate limiter ───────────────────────────────────────────────

let lastRequestTime = 0;
const MIN_DELAY_MS = 500;

const requestQueue: Array<{
  resolve: (html: string) => void;
  reject: (err: Error) => void;
  query: string;
  timeoutMs: number;
}> = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (requestQueue.length > 0) {
    const item = requestQueue.shift()!;

    const cached = getCached(item.query);
    if (cached) {
      item.resolve(cached);
      continue;
    }

    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_DELAY_MS) {
      await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
    }

    try {
      const html = await fetchBraveApi(item.query, item.timeoutMs);
      lastRequestTime = Date.now();
      if (html) {
        setCache(item.query, html);
        item.resolve(html);
      } else {
        item.resolve("");
      }
    } catch (e) {
      item.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  processing = false;
}

// ─── Brave Search API ───────────────────────────────────────────

async function fetchBraveApi(query: string, timeoutMs: number): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn("[Brave] BRAVE_SEARCH_API_KEY not set — search disabled");
    return "";
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) {
      console.warn(`[Brave API] HTTP ${res.status} for: "${query.slice(0, 50)}..."`);
      return "";
    }

    const data = await res.json() as {
      web?: { results?: Array<{ url: string; title: string; description: string }> };
    };

    const results = data.web?.results ?? [];
    if (results.length === 0) {
      console.log(`[Brave API] No results for: "${query.slice(0, 50)}..."`);
      return "";
    }

    console.log(`[Brave API] ${results.length} results for: "${query.slice(0, 50)}..."`);

    // Build synthetic HTML matching the format existing parsers expect
    const snippets = results.map((r, i) => `
      <div class="snippet svelte-abc123" data-pos="${i}" data-type="web">
        <a href="${esc(r.url)}" class="svelte-abc123 l1">${esc(r.title)}</a>
        <div class="title svelte-abc123">${esc(r.title)}</div>
        <div class="content svelte-abc123">${esc(r.description)}</div>
      </div>
    `).join("\n");

    return `<html><body><main>${snippets}</main></body></html>`;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      console.warn(`[Brave API] Timeout for: "${query.slice(0, 50)}..."`);
    } else {
      console.warn(`[Brave API] Error:`, e instanceof Error ? e.message : e);
    }
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Public API ─────────────────────────────────────────────────

export async function braveSearch(query: string, timeoutMs = 10000): Promise<string> {
  const cached = getCached(query);
  if (cached) {
    console.log(`[Brave] Cache hit for: "${query.slice(0, 60)}..."`);
    return cached;
  }

  return new Promise<string>((resolve, reject) => {
    requestQueue.push({ resolve, reject, query, timeoutMs });
    processQueue();
  });
}

export function clearBraveCache(): void {
  cache.clear();
}
