/**
 * Screen Understanding Pipeline — multi-stage vision analysis for screenshots.
 *
 * Instead of a single "describe this image" call, this pipeline:
 * 1. Classifies the screenshot type (receipt, error, menu, conversation, etc.)
 * 2. Extracts structured data using type-specific prompts
 * 3. Suggests (or auto-executes) follow-up actions
 *
 * This turns every screenshot into actionable intelligence.
 */
import { analyzeImage } from "../vision.js";
import { richSearch } from "../webSearch.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenType =
  | "receipt"
  | "error"
  | "menu"
  | "conversation"
  | "profile"
  | "schedule"
  | "map"
  | "screenshot"
  | "photo";

export interface ScreenAnalysis {
  type: ScreenType;
  structured_data: Record<string, unknown>;
  summary: string;
  suggested_actions: string[];
  /** Pre-fetched action results (e.g., error search results) */
  action_results?: string;
}

// ---------------------------------------------------------------------------
// Stage 1: Classification
// ---------------------------------------------------------------------------

const CLASSIFY_PROMPT = `Classify this image into exactly ONE category. Reply with ONLY the category name, nothing else.

Categories:
- receipt: A receipt, bill, invoice, or payment confirmation
- error: An error message, crash screen, or bug dialog
- menu: A restaurant menu or food menu
- conversation: A text conversation, DM, or chat screenshot
- profile: A social media profile, contact card, or about page
- schedule: A calendar, timetable, or schedule view
- map: A map, directions, or location view
- screenshot: A general app screenshot (settings, dashboard, etc.)
- photo: A regular photo of a person, place, or thing (not a screenshot)

Reply with ONLY one word from the list above.`;

async function classifyScreen(imageBase64: string): Promise<ScreenType> {
  try {
    const result = await analyzeImage(imageBase64, CLASSIFY_PROMPT);
    const cleaned = result.trim().toLowerCase().replace(/[^a-z]/g, "");

    const validTypes: ScreenType[] = [
      "receipt", "error", "menu", "conversation", "profile",
      "schedule", "map", "screenshot", "photo",
    ];

    if (validTypes.includes(cleaned as ScreenType)) {
      return cleaned as ScreenType;
    }

    // Fuzzy match
    for (const t of validTypes) {
      if (cleaned.includes(t)) return t;
    }

    return "photo"; // Default
  } catch {
    return "photo";
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Structured extraction (type-specific prompts)
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPTS: Record<ScreenType, string> = {
  receipt: `Extract from this receipt. Return ONLY valid JSON:
{
  "merchant": "store name",
  "date": "YYYY-MM-DD or null",
  "items": [{"name": "item name", "price": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "payment_method": "card/cash/null"
}
If a field isn't visible, use null. Keep item names short.`,

  error: `Extract from this error screen. Return ONLY valid JSON:
{
  "app": "app or service name",
  "error_code": "code or null",
  "error_message": "the actual error text",
  "context": "what the user was trying to do",
  "severity": "critical/warning/info"
}`,

  menu: `Extract from this menu. Return ONLY valid JSON:
{
  "restaurant": "restaurant name or null",
  "items": [{"name": "dish name", "price": 0.00, "description": "short desc or null"}],
  "cuisine": "type of food"
}
List the 10 most prominent items.`,

  conversation: `Analyze this conversation screenshot. Return ONLY valid JSON:
{
  "platform": "iMessage/WhatsApp/Instagram/etc",
  "participants": ["name1", "name2"],
  "context": "brief context of the conversation",
  "last_message": "the most recent message text",
  "last_sender": "who sent the last message",
  "tone": "casual/formal/urgent/emotional",
  "needs_reply": true/false,
  "suggested_reply": "a natural reply suggestion or null"
}`,

  profile: `Extract from this profile. Return ONLY valid JSON:
{
  "platform": "Instagram/LinkedIn/Twitter/etc",
  "name": "display name",
  "username": "handle or null",
  "bio": "bio text or null",
  "followers": "count or null",
  "summary": "one sentence about who this person is"
}`,

  schedule: `Extract from this schedule/calendar view. Return ONLY valid JSON:
{
  "date_range": "what dates are visible",
  "events": [{"title": "event name", "time": "time or time range", "date": "YYYY-MM-DD"}],
  "free_slots": ["list of visible free time blocks"],
  "busiest_day": "which day has the most events"
}`,

  map: `Extract from this map view. Return ONLY valid JSON:
{
  "location": "the main location/destination shown",
  "address": "street address if visible",
  "nearby": ["notable nearby places"],
  "context": "directions/search/sharing/etc"
}`,

  screenshot: `Analyze this app screenshot. Return ONLY valid JSON:
{
  "app": "app name",
  "screen": "what screen/page this is",
  "key_info": "the most important information visible",
  "action_items": ["any actions or items that need attention"]
}`,

  photo: `Describe this photo briefly. Return ONLY valid JSON:
{
  "subject": "main subject of the photo",
  "description": "one-sentence description",
  "notable_details": ["any notable text, brands, or details visible"]
}`,
};

async function extractStructuredData(
  imageBase64: string,
  type: ScreenType,
): Promise<Record<string, unknown>> {
  try {
    const prompt = EXTRACTION_PROMPTS[type];
    const result = await analyzeImage(imageBase64, prompt);
    const cleaned = result.replace(/```json?\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn(`[ScreenPipeline] Extraction failed for ${type}:`, e);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Action generation + execution
// ---------------------------------------------------------------------------

function generateActions(
  type: ScreenType,
  data: Record<string, unknown>,
): { actions: string[]; autoAction?: () => Promise<string> } {
  switch (type) {
    case "receipt": {
      const total = data.total as number | null;
      const merchant = data.merchant as string | null;
      const actions = [
        total ? `Log expense: $${total} at ${merchant ?? "unknown"}` : null,
        total && total > 20 ? "Split with friends via Venmo" : null,
        "Save receipt to records",
      ].filter(Boolean) as string[];
      return { actions };
    }

    case "error": {
      const errorMsg = data.error_message as string | null;
      const actions = [
        errorMsg ? "Search for solution" : null,
        "Screenshot saved for reference",
      ].filter(Boolean) as string[];

      // Auto-search for the error
      const autoAction = errorMsg
        ? async () => {
            try {
              const { results } = await richSearch(`fix "${errorMsg}"`, {
                maxResults: 2,
                searchDepth: "basic",
              });
              if (results.length > 0) {
                return `\n\nI searched for that error — ${results[0].content.slice(0, 200)}`;
              }
            } catch {}
            return "";
          }
        : undefined;

      return { actions, autoAction };
    }

    case "menu": {
      const restaurant = data.restaurant as string | null;
      const actions = [
        restaurant ? `Look up ${restaurant} reviews` : "Look up restaurant reviews",
        "Find highest-rated dishes",
        "Check for dietary restrictions",
      ];
      return { actions };
    }

    case "conversation": {
      const needsReply = data.needs_reply as boolean | null;
      const suggestedReply = data.suggested_reply as string | null;
      const actions = [
        needsReply && suggestedReply ? `Reply: "${suggestedReply}"` : null,
        "Summarize conversation",
        "Draft a reply",
      ].filter(Boolean) as string[];
      return { actions };
    }

    case "profile": {
      const name = data.name as string | null;
      const platform = data.platform as string | null;
      const actions = [
        name ? `Look up more about ${name}` : null,
        platform ? `Open their ${platform} profile` : null,
        "Save contact info",
      ].filter(Boolean) as string[];
      return { actions };
    }

    case "schedule": {
      const actions = [
        "Find free time slots",
        "Set reminders for events",
        "Share availability",
      ];
      return { actions };
    }

    default:
      return { actions: [] };
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full screen understanding pipeline on an image.
 * Returns structured analysis with type, data, summary, and suggested actions.
 */
export async function analyzeScreen(imageBase64: string): Promise<ScreenAnalysis> {
  // Stage 1: Classify
  const type = await classifyScreen(imageBase64);
  console.log(`[ScreenPipeline] Classified as: ${type}`);

  // Stage 2: Extract structured data
  const structured_data = await extractStructuredData(imageBase64, type);
  console.log(`[ScreenPipeline] Extracted ${Object.keys(structured_data).length} fields`);

  // Stage 3: Generate actions
  const { actions, autoAction } = generateActions(type, structured_data);

  // Execute auto-action if available (e.g., searching for an error)
  let action_results: string | undefined;
  if (autoAction) {
    try {
      action_results = await autoAction();
    } catch (e) {
      console.warn("[ScreenPipeline] Auto-action failed:", e);
    }
  }

  // Build human-readable summary
  const summary = buildSummary(type, structured_data);

  return {
    type,
    structured_data,
    summary,
    suggested_actions: actions,
    action_results,
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(type: ScreenType, data: Record<string, unknown>): string {
  switch (type) {
    case "receipt": {
      const merchant = data.merchant as string | null;
      const total = data.total as number | null;
      const items = data.items as Array<{ name: string }> | null;
      const itemCount = items?.length ?? 0;
      return `Receipt from ${merchant ?? "unknown"}: ${itemCount} items, total $${total ?? "?"}`;
    }

    case "error": {
      const app = data.app as string | null;
      const msg = data.error_message as string | null;
      return `Error in ${app ?? "an app"}: ${msg ?? "unknown error"}`;
    }

    case "menu": {
      const restaurant = data.restaurant as string | null;
      const cuisine = data.cuisine as string | null;
      const items = data.items as Array<{ name: string }> | null;
      return `Menu from ${restaurant ?? "a restaurant"} (${cuisine ?? "unknown cuisine"}), ${items?.length ?? 0} items visible`;
    }

    case "conversation": {
      const platform = data.platform as string | null;
      const context = data.context as string | null;
      const needsReply = data.needs_reply as boolean | null;
      return `${platform ?? "Chat"} conversation: ${context ?? "unknown context"}${needsReply ? " — needs a reply" : ""}`;
    }

    case "profile": {
      const name = data.name as string | null;
      const platform = data.platform as string | null;
      const summary = data.summary as string | null;
      return summary ?? `${name ?? "Someone"}'s ${platform ?? ""} profile`;
    }

    case "schedule": {
      const events = data.events as Array<{ title: string }> | null;
      const dateRange = data.date_range as string | null;
      return `Schedule (${dateRange ?? "unknown dates"}): ${events?.length ?? 0} events`;
    }

    case "map": {
      const location = data.location as string | null;
      return `Map: ${location ?? "unknown location"}`;
    }

    case "screenshot": {
      const app = data.app as string | null;
      const keyInfo = data.key_info as string | null;
      return `${app ?? "App"} screenshot: ${keyInfo ?? "general view"}`;
    }

    case "photo": {
      const description = data.description as string | null;
      return description ?? "A photo";
    }

    default:
      return "Image received";
  }
}

/**
 * Build a context string for the LLM from the screen analysis.
 * Replaces the simple visionContext string in imessageRuntime.ts.
 */
export function buildScreenContext(analysis: ScreenAnalysis): string {
  const parts = [
    `[Screenshot analysis — type: ${analysis.type}]`,
    analysis.summary,
  ];

  if (Object.keys(analysis.structured_data).length > 0) {
    parts.push(`Extracted data: ${JSON.stringify(analysis.structured_data)}`);
  }

  if (analysis.suggested_actions.length > 0) {
    parts.push(`Suggested actions: ${analysis.suggested_actions.join(", ")}`);
  }

  if (analysis.action_results) {
    parts.push(analysis.action_results);
  }

  return parts.join("\n");
}
