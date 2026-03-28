// In-memory daily API spend tracker. Resets each calendar day.
// Cap is configurable via BIT7_DAILY_SPEND_CAP_USD (default $3).

let todayKey = "";
let todaySpend = 0;

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10); // "2026-02-26"
}

function ensureToday() {
  const key = getDateKey();
  if (key !== todayKey) {
    todayKey = key;
    todaySpend = 0;
  }
}

export function getDailySpend(): number {
  ensureToday();
  return todaySpend;
}

// Model pricing table (per million tokens)
interface ModelPricing { input: number; output: number; cacheWrite: number; cacheRead: number; }
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Sonnet 4
  "claude-sonnet-4-6":       { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4-5":       { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  // Claude Opus 4
  "claude-opus-4-6":         { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  // Claude Haiku 4
  "claude-haiku-4-5":        { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  // Gemini 3.1 Flash-Lite
  "gemini-flash-lite-latest":               { input: 0.25, output: 1.50, cacheWrite: 0.025, cacheRead: 0.025 },
};

export function getModelPricing(modelId: string): ModelPricing {
  // Direct match
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
  // Prefix match
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(key)) return pricing;
  }
  // Infer from name patterns
  if (/opus/i.test(modelId)) return MODEL_PRICING["claude-opus-4-6"];
  if (/haiku/i.test(modelId)) return MODEL_PRICING["claude-haiku-4-5"];
  if (/gemini/i.test(modelId)) return MODEL_PRICING["gemini-flash-lite-latest"];
  // Default to Sonnet pricing
  return MODEL_PRICING["claude-sonnet-4-6"];
}

export function calculateCost(
  modelId: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): number {
  const pricing = getModelPricing(modelId);
  const cr = usage.cache_read_input_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const uc = usage.input_tokens - cr - cw;
  return (uc * pricing.input + cw * pricing.cacheWrite + cr * pricing.cacheRead + usage.output_tokens * pricing.output) / 1_000_000;
}

export function getDailyCap(): number {
  const cap = Number(process.env.BIT7_DAILY_SPEND_CAP_USD);
  return (!cap || isNaN(cap) || cap <= 0) ? 3 : cap;
}

export function canSpend(): boolean {
  ensureToday();
  return todaySpend < getDailyCap();
}

export function recordSpend(usd: number) {
  ensureToday();
  todaySpend += usd;
  console.log(`[cost] +$${usd.toFixed(4)} — daily total: $${todaySpend.toFixed(4)} / $${getDailyCap()} cap`);
}
