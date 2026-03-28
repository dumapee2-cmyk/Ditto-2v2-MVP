/**
 * LLM compatibility layer — adapts API parameters for the active provider.
 */

export interface LLMCapabilities {
  supportsToolUse: boolean;
  supportsCacheControl: boolean;
  provider: "anthropic" | "gemini" | "unknown";
}

let _cached: LLMCapabilities | null = null;

export function detectCapabilities(): LLMCapabilities {
  if (_cached) return _cached;

  // Default to Gemini
  _cached = { supportsToolUse: true, supportsCacheControl: false, provider: "gemini" };
  return _cached;
}

/**
 * Structured telemetry log for every LLM call site.
 * feature: reasoner | research | design | content | codegen | repair | chat | clarify | intentClassifier
 */
export function llmLog(feature: string, extras?: Record<string, unknown>): void {
  const caps = detectCapabilities();
  const mode = caps.supportsToolUse ? "tool" : "json";
  const parts = [`[LLM] provider=${caps.provider}, mode=${mode}, feature=${feature}`];
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      parts.push(`${k}=${String(v)}`);
    }
  }
  console.log(parts.join(", "));
}

/**
 * Strip thinking-model tags from text responses.
 */
export function stripThinkingContent(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, "");
  return cleaned.trim();
}

/**
 * Extract usable text from an Anthropic SDK response content array.
 */
export function extractTextFromResponse(
  content: Array<{ type: string; text?: string; thinking?: string }>,
): string {
  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === "thinking") continue;
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
    }
  }
  return stripThinkingContent(textParts.join("\n")).trim();
}

/** Extract JSON from a text response (handles markdown code blocks and thinking tags). */
export function extractJSON(text: string): string {
  const cleaned = stripThinkingContent(text);
  const fenced = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) {
    const candidate = fenced[1].trim();
    try { JSON.parse(candidate); return candidate; } catch { /* not valid JSON, continue */ }
  }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { JSON.parse(objMatch[0]); return objMatch[0].trim(); } catch { /* not valid JSON */ }
  }
  return cleaned.trim();
}

/**
 * Extract code content from markdown fences in a text response.
 */
export function extractCodeFromFences(text: string): string | null {
  const cleaned = stripThinkingContent(text);
  const fenced = cleaned.match(/```(?:jsx?|tsx?|javascript)?\s*\n([\s\S]*?)\n```/);
  if (fenced && fenced[1].trim().length > 50) {
    return fenced[1].trim();
  }
  return null;
}
