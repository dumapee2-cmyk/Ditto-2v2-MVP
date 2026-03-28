/**
 * Kimi Visual Agent — screenshots competitor websites and uses
 * Kimi K2.5 vision to analyze their UI for replication.
 *
 * Pipeline: competitor name → thum.io screenshot → Kimi vision analysis → structured output
 * Fallback: if vision fails, falls back to HTML meta-tag scraping.
 * No new npm dependencies — uses Node built-in fetch() + Anthropic SDK.
 */

import type Anthropic from "@anthropic-ai/sdk";

export interface ScreenshotAnalysis {
  color_palette: string[];
  layout_type: string;
  component_patterns: string[];
  navigation_style: string;
  image_usage: string;
  interactive_elements: string[];
  key_ui_to_replicate: string[];
  // Granular CSS-level visual extraction
  background_treatment: string;
  card_design_spec: string;
  typography_hierarchy: string;
  spacing_pattern: string;
  gradient_specs: string[];
  border_and_shadow_system: string;
  hero_section_spec: string;
  section_patterns: string[];
}

export interface CompetitorVisual {
  name: string;
  url: string;
  screenshot_analysis: ScreenshotAnalysis | null;
  colors: string[];
  og_image: string | null;
  layout_signals: string[];
  meta_description: string;
}

/* ------------------------------------------------------------------ */
/*  Step A: Screenshot capture + HTML scraping                         */
/* ------------------------------------------------------------------ */

interface RawCapture {
  name: string;
  url: string;
  screenshotBase64: string | null;
  html: string | null;
}

function resolveCompetitorUrl(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `https://${clean}.com`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Bit7/1.0)" },
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Capture a specific URL directly (used when the user references a site explicitly).
 * Unlike captureCompetitor(), this takes a full URL instead of guessing from a name.
 */
export async function captureDirectUrl(url: string, label?: string): Promise<RawCapture> {
  const name = label ?? new URL(url).hostname.replace(/^www\./, "");
  const result: RawCapture = { name, url, screenshotBase64: null, html: null };

  const screenshotUrl = `https://image.thum.io/get/width/1280/crop/900/${url}`;
  const [screenshotResult, htmlResult] = await Promise.allSettled([
    fetchWithTimeout(screenshotUrl, 12000).then(async (res) => {
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    }),
    fetchWithTimeout(url, 8000).then(async (res) => {
      if (!res.ok) return null;
      const text = await res.text();
      return text.slice(0, 80000); // Allow more HTML for direct references
    }),
  ]);

  if (screenshotResult.status === "fulfilled" && screenshotResult.value) {
    result.screenshotBase64 = screenshotResult.value;
  }
  if (htmlResult.status === "fulfilled" && htmlResult.value) {
    result.html = htmlResult.value;
  }

  return result;
}

/**
 * Full scrape + vision analysis for a single directly-referenced URL.
 * Returns a CompetitorVisual with priority analysis data.
 */
export async function scrapeReferenceUrl(
  url: string,
  label: string,
  client: Anthropic,
  modelId: string,
): Promise<CompetitorVisual | null> {
  try {
    const capture = await captureDirectUrl(url, label);

    const htmlMeta = capture.html
      ? extractHtmlMetadata(capture.html)
      : { colors: [], og_image: null, layout_signals: [], meta_description: "" };

    let screenshot_analysis: ScreenshotAnalysis | null = null;
    if (capture.screenshotBase64) {
      screenshot_analysis = await analyzeScreenshot(client, modelId, label, capture.screenshotBase64);
    }

    return {
      name: label,
      url,
      screenshot_analysis,
      ...htmlMeta,
    };
  } catch (e) {
    console.warn(`Reference URL scrape failed for ${url}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function captureCompetitor(name: string): Promise<RawCapture> {
  const url = resolveCompetitorUrl(name);
  const result: RawCapture = { name, url, screenshotBase64: null, html: null };

  // Fetch screenshot from thum.io (free, no API key, 1000/month)
  const screenshotUrl = `https://image.thum.io/get/width/1280/crop/900/${url}`;
  const [screenshotResult, htmlResult] = await Promise.allSettled([
    fetchWithTimeout(screenshotUrl, 10000).then(async (res) => {
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    }),
    fetchWithTimeout(url, 6000).then(async (res) => {
      if (!res.ok) return null;
      const text = await res.text();
      // Only keep the first 50KB to avoid memory issues
      return text.slice(0, 50000);
    }),
  ]);

  if (screenshotResult.status === "fulfilled" && screenshotResult.value) {
    result.screenshotBase64 = screenshotResult.value;
  }
  if (htmlResult.status === "fulfilled" && htmlResult.value) {
    result.html = htmlResult.value;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  HTML meta-tag extraction (fallback when vision unavailable)        */
/* ------------------------------------------------------------------ */

function extractHtmlMetadata(html: string): {
  colors: string[];
  og_image: string | null;
  layout_signals: string[];
  meta_description: string;
} {
  const colors: string[] = [];
  let og_image: string | null = null;
  let meta_description = "";
  const layout_signals: string[] = [];

  // Extract meta tags
  const ogImageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i)
    ?? html.match(/content="([^"]+)"\s+(?:property|name)="og:image"/i);
  if (ogImageMatch) og_image = ogImageMatch[1];

  const themeColorMatch = html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i)
    ?? html.match(/content="([^"]+)"\s+name="theme-color"/i);
  if (themeColorMatch) colors.push(themeColorMatch[1]);

  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
    ?? html.match(/content="([^"]+)"\s+name="description"/i);
  if (descMatch) meta_description = descMatch[1].slice(0, 200);

  // Extract hex colors from inline styles (max 5)
  const hexMatches = html.match(/#[0-9a-fA-F]{6}/g);
  if (hexMatches) {
    const unique = [...new Set(hexMatches)].slice(0, 5);
    colors.push(...unique);
  }

  // Detect layout patterns from class names
  const classPatterns = [
    { pattern: /class="[^"]*grid[^"]*"/gi, signal: "grid-layout" },
    { pattern: /class="[^"]*card[^"]*"/gi, signal: "card-components" },
    { pattern: /class="[^"]*sidebar[^"]*"/gi, signal: "sidebar" },
    { pattern: /class="[^"]*hero[^"]*"/gi, signal: "hero-section" },
    { pattern: /class="[^"]*nav[^"]*"/gi, signal: "navigation" },
    { pattern: /class="[^"]*modal[^"]*"/gi, signal: "modals" },
    { pattern: /class="[^"]*table[^"]*"/gi, signal: "tables" },
  ];

  for (const { pattern, signal } of classPatterns) {
    if (pattern.test(html)) layout_signals.push(signal);
  }

  return {
    colors: [...new Set(colors)].slice(0, 5),
    og_image,
    layout_signals,
    meta_description,
  };
}

/* ------------------------------------------------------------------ */
/*  Step B: Kimi Vision analysis                                       */
/* ------------------------------------------------------------------ */

const visionToolSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    color_palette: {
      type: "array", items: { type: "string" }, maxItems: 8,
      description: "ALL hex colors visible including background, text, accents, borders, gradient endpoints. Include opacity variants like '#7c3aed at 20% opacity'. Be exhaustive.",
    },
    layout_type: {
      type: "string",
      description: "Describe the EXACT spatial layout as CSS: e.g. 'Full-width stacked sections: sticky nav 64px -> hero section py-24 max-w-6xl mx-auto -> 3-column feature grid gap-8 -> pricing 3-col grid -> footer'. NOT just 'card-grid'.",
    },
    component_patterns: {
      type: "array", items: { type: "string" }, maxItems: 10,
      description: "Describe each component with EXACT visual specs. NOT 'search bar' but 'Full-width search input h-12 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm with Search icon left-padded pl-12 and placeholder text-white/30'. Include ALL visible components.",
    },
    navigation_style: {
      type: "string",
      description: "Describe nav with exact specs: height, background (transparent/blur/solid), logo position, link spacing, CTA button style. e.g. 'Sticky nav h-16 bg-transparent backdrop-blur-md, logo left flex items-center gap-2, nav links center gap-8 text-sm text-white/70 hover:text-white, CTA right rounded-full px-6 bg-gradient-to-r from-purple-600 to-blue-500'",
    },
    image_usage: {
      type: "string",
      description: "Describe image treatment exactly: sizes, border-radius, overlay gradients, aspect ratios, placeholder patterns. e.g. 'Product cards use 16:9 ratio images with rounded-t-xl overflow-hidden, slight dark gradient overlay at bottom for text readability'",
    },
    interactive_elements: {
      type: "array", items: { type: "string" }, maxItems: 8,
      description: "Describe hover/click effects with exact CSS: 'Cards hover: translateY(-4px) shadow-2xl transition-all 300ms, border glow var(--primary)/30'. Include transition durations and easing.",
    },
    key_ui_to_replicate: {
      type: "array", items: { type: "string" }, maxItems: 8,
      description: "The most visually impressive elements described as IMPLEMENTATION INSTRUCTIONS: 'Build a hero section with radial gradient bg from purple-900/40 at center to transparent, centered flex-col items-center text-center, animated gradient badge pill with border, 56px font-black heading with gradient text effect, 18px subtitle in text-white/60, two buttons side-by-side: primary with gradient bg and glow shadow, secondary with border border-white/20'",
    },
    background_treatment: {
      type: "string",
      description: "EXACT background CSS stack: base color, gradients, patterns, overlays. e.g. 'Base #030712 (gray-950), radial-gradient(ellipse at top center, rgba(124,58,237,0.15), transparent 60%), subtle dot grid pattern at 2% opacity'. Describe ALL layers.",
    },
    card_design_spec: {
      type: "string",
      description: "EXACT card CSS: background, border, radius, padding, shadow, hover state, internal spacing. e.g. 'bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 shadow-none, hover:border-white/[0.16] hover:bg-white/[0.06] transition-all 200ms. Internal: icon-box 48px rounded-xl bg-gradient mb-4, title text-lg font-semibold mb-2, description text-sm text-gray-400 leading-relaxed'",
    },
    typography_hierarchy: {
      type: "string",
      description: "EXACT font specs for each level: 'H1: 56px/64px font-black tracking-[-0.02em] text-white, H2: 36px/44px font-bold tracking-tight, H3: 20px font-semibold, Body: 16px/28px text-gray-400 font-normal, Caption: 13px text-gray-500 font-medium'. Include letter-spacing and line-height.",
    },
    spacing_pattern: {
      type: "string",
      description: "EXACT spacing: 'Nav: h-16 px-6, Hero: py-24, Sections: py-20, Card grid: gap-6, Card padding: p-6, Content max-width: max-w-6xl, Heading margin-bottom: mb-4, Subheading mb: mb-12'. Be precise with rem/px values.",
    },
    gradient_specs: {
      type: "array", items: { type: "string" }, maxItems: 6,
      description: "Every gradient visible with exact direction, colors, and usage: 'CTA button: linear-gradient(135deg, #7c3aed, #3b82f6) with box-shadow 0 4px 24px rgba(124,58,237,0.4)', 'Hero bg: radial-gradient(600px circle at 50% 0%, rgba(124,58,237,0.15), transparent)'",
    },
    border_and_shadow_system: {
      type: "string",
      description: "Systematic border and shadow values: 'Cards: border border-white/[0.08] shadow-none hover:shadow-lg, Inputs: border border-white/[0.12] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20, Buttons: shadow-md hover:shadow-xl'",
    },
    hero_section_spec: {
      type: "string",
      description: "Full hero section layout as implementation steps: 'Centered flex-col items-center text-center py-24 px-6. Small gradient badge pill at top (text-xs font-semibold px-4 py-1.5 rounded-full bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 text-purple-300 mb-6). Heading text-5xl md:text-6xl font-black tracking-tight text-white mb-6. Subtitle text-lg text-gray-400 max-w-2xl mb-10. Two buttons: primary gradient px-8 h-12, secondary border-white/20 px-8 h-12.'",
    },
    section_patterns: {
      type: "array", items: { type: "string" }, maxItems: 6,
      description: "Each page section as implementation spec: 'Features section: py-20, centered H2 + subtitle mb-12, grid grid-cols-1 md:grid-cols-3 gap-8, each card has 48px icon-box with gradient bg -> h3 title -> p description text-gray-400'. Describe EVERY visible section.",
    },
  },
  required: [
    "color_palette", "layout_type", "component_patterns",
    "navigation_style", "image_usage", "interactive_elements", "key_ui_to_replicate",
    "background_treatment", "card_design_spec", "typography_hierarchy",
    "spacing_pattern", "gradient_specs", "border_and_shadow_system",
    "hero_section_spec", "section_patterns",
  ],
};

async function analyzeScreenshot(
  client: Anthropic,
  modelId: string,
  competitorName: string,
  screenshotBase64: string,
): Promise<ScreenshotAnalysis | null> {
  try {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64,
            },
          },
          {
            type: "text",
            text: `You are a CSS engineer reverse-engineering this UI screenshot of ${competitorName}'s website.

Extract EXACT visual specifications as if writing a CSS design system document. Do NOT use vague descriptions like "modern" or "clean". Instead, describe:
- Exact hex colors with opacity values
- Exact spacing in px/rem
- Exact border-radius, border-width, border-color with opacity
- Exact shadow values (offset, blur, spread, color)
- Exact gradient directions and color stops
- Exact typography: font-size, font-weight, letter-spacing, line-height, color
- Exact hover/transition effects with durations and easing
- Every section of the page from top to bottom as implementable CSS/Tailwind specs

Think of this as providing a developer everything they need to pixel-perfect replicate this UI without seeing the screenshot. Be extremely specific.`,
          },
        ],
      }],
      tools: [{
        name: "analyze_competitor_ui",
        description: "Extract structured UI analysis from a competitor website screenshot",
        input_schema: visionToolSchema,
      }],
      tool_choice: { type: "tool", name: "analyze_competitor_ui" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    return toolUse.input as ScreenshotAnalysis;
  } catch (e) {
    console.warn(`Vision analysis failed for ${competitorName}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

export async function scrapeCompetitorVisuals(
  competitors: Array<{ name: string }>,
  client: Anthropic,
  modelId: string,
): Promise<CompetitorVisual[]> {
  const MAX_COMPETITORS = 3;
  const TOTAL_TIMEOUT_MS = 25000;

  const targets = competitors.slice(0, MAX_COMPETITORS);
  const results: CompetitorVisual[] = [];

  // Step A: Capture screenshots + HTML in parallel (with total timeout)
  const capturePromises = targets.map((c) => captureCompetitor(c.name));
  const captureResults = await Promise.race([
    Promise.allSettled(capturePromises),
    new Promise<PromiseSettledResult<RawCapture>[]>((resolve) =>
      setTimeout(() => resolve(targets.map(() => ({
        status: "rejected" as const,
        reason: new Error("Total timeout"),
      }))), TOTAL_TIMEOUT_MS)
    ),
  ]);

  const captures: RawCapture[] = [];
  for (const result of captureResults) {
    if (result.status === "fulfilled") {
      captures.push(result.value);
    }
  }

  // Step B: Run vision analysis in parallel for captures with screenshots
  const analysisPromises = captures.map(async (capture): Promise<CompetitorVisual> => {
    const htmlMeta = capture.html
      ? extractHtmlMetadata(capture.html)
      : { colors: [], og_image: null, layout_signals: [], meta_description: "" };

    let screenshot_analysis: ScreenshotAnalysis | null = null;
    if (capture.screenshotBase64) {
      screenshot_analysis = await analyzeScreenshot(
        client, modelId, capture.name, capture.screenshotBase64
      );
    }

    return {
      name: capture.name,
      url: capture.url,
      screenshot_analysis,
      ...htmlMeta,
    };
  });

  const analysisResults = await Promise.allSettled(analysisPromises);
  for (const result of analysisResults) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    }
  }

  return results;
}
