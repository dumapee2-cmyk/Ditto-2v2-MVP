import type { PipelineContext, StateTransition } from "../types.js";
import { extractReferences } from "../../referenceExtractor.js";
import { searchForProduct, fetchSiteSummary, isParkedDomain, richSearch, isRichSearchAvailable } from "../../webSearch.js";

/**
 * RESEARCHING state: gather domain context for SMS agent generation.
 * This is fail-safe — errors don't block the pipeline.
 *
 * If the user says "like [product]" or includes a URL, we:
 *  1. Web search to discover what the product actually is
 *  2. Feed context into the reasoning stage
 */
export async function handleResearch(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Researching domain..." });

  const references = extractReferences(ctx.prompt);
  let webSearchContext = "";

  // Step 1: Resolve product references ("like Cal AI", "like MyFitnessPal")
  if (references.length > 0) {
    const ref = references[0];
    try {
      if (!ref.isExplicitUrl) {
        ctx.onProgress?.({ type: "status", message: `Searching for ${ref.raw}...` });
        console.log(`Web searching for product: "${ref.raw}" (engine: ${isRichSearchAvailable() ? "Tavily" : "Brave"})`);

        let searchResult: Awaited<ReturnType<typeof searchForProduct>>;
        if (isRichSearchAvailable()) {
          const tavilyResult = await richSearch(`${ref.raw} app official website`, { maxResults: 5, searchDepth: "basic" });
          const results = tavilyResult.results.map(r => ({ title: r.title, url: r.url, snippet: r.content }));
          const productResult = results.find(r => {
            try {
              const hostname = new URL(r.url).hostname.toLowerCase();
              return !["youtube.com", "twitter.com", "x.com", "reddit.com", "wikipedia.org", "amazon.com"].some(d => hostname.includes(d));
            } catch { return false; }
          });
          searchResult = {
            url: productResult?.url ?? results[0]?.url ?? null,
            description: results.slice(0, 3).map(r => r.snippet).filter(s => s.length > 10).join(" ").slice(0, 500),
            results,
          };
        } else {
          searchResult = await searchForProduct(ref.raw);
        }

        if (searchResult.url) {
          console.log(`Web search found URL for "${ref.raw}": ${searchResult.url}`);
          ref.url = searchResult.url;
        }

        if (searchResult.description) {
          webSearchContext += `\n\n--- WEB SEARCH RESULTS FOR "${ref.raw}" ---\n`;
          webSearchContext += `Product URL: ${searchResult.url ?? "unknown"}\n`;
          webSearchContext += `Description: ${searchResult.description}\n`;
          if (searchResult.results.length > 0) {
            webSearchContext += `Top results:\n`;
            for (const r of searchResult.results.slice(0, 5)) {
              webSearchContext += `  - ${r.title} (${r.url})\n`;
              if (r.snippet) webSearchContext += `    ${r.snippet.slice(0, 200)}\n`;
            }
          }
        }

        // Fetch homepage meta for richer summary
        if (ref.url) {
          try {
            const siteSummary = await fetchSiteSummary(ref.url);
            if (siteSummary) {
              if (isParkedDomain(siteSummary)) {
                console.warn(`[Research] Parked domain detected at ${ref.url} — rejecting`);
                ref.url = "";
                webSearchContext = "";
              } else {
                webSearchContext += `Site summary: ${siteSummary}\n`;
              }
            }
          } catch {
            // non-fatal
          }
        }
      }

      if (webSearchContext) {
        ctx.webSearchContext = webSearchContext;
      }
    } catch (e) {
      console.warn(`Reference search failed for "${ref.raw}" (non-fatal):`, e);
    }
  }

  // Step 2: Contextual search for ALL prompts (even without references)
  if (isRichSearchAvailable() && !webSearchContext) {
    try {
      ctx.onProgress?.({ type: "status", message: "Gathering domain context..." });
      const tavilyResults = await richSearch(ctx.prompt, { maxResults: 5, searchDepth: "basic" });
      if (tavilyResults.results.length > 0) {
        webSearchContext += `\n\n--- WEB CONTEXT FOR PROMPT ---\n`;
        for (const r of tavilyResults.results.slice(0, 5)) {
          webSearchContext += `- ${r.title} (${r.url})\n  ${r.content.slice(0, 300)}\n`;
        }
        ctx.webSearchContext = webSearchContext;
        console.log(`[Research] Tavily contextual search: ${tavilyResults.results.length} results`);
      }
    } catch (e) {
      console.warn("[Research] Tavily contextual search failed (non-fatal):", e);
    }
  }

  return { nextState: "REASONING" };
}
