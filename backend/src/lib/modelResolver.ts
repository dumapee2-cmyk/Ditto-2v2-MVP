/**
 * Centralized model resolution — picks provider-appropriate model IDs
 * based on env overrides and Gemini defaults.
 */

import { detectCapabilities, type LLMCapabilities } from "./llmCompat.js";

export type ModelTier = "fast" | "standard" | "premium";

/** Pipeline stage — controls which model + temperature to use per step. */
export type ModelStage = "reasoning" | "codegen" | "critic" | "repair";

const GEMINI_DEFAULTS: Record<ModelTier, string> = {
  fast: "gemini-flash-lite-latest",
  standard: "gemini-flash-lite-latest",
  premium: "gemini-flash-lite-latest",
};

const TIER_ENV_KEYS: Record<ModelTier, string> = {
  fast: "AI_MODEL_FAST",
  standard: "AI_MODEL_STANDARD",
  premium: "AI_MODEL_PREMIUM",
};

/** Stage → tier mapping (which tier each stage defaults to) */
const STAGE_TIER: Record<ModelStage, ModelTier> = {
  reasoning: "standard",   // deep thinking
  codegen: "standard",     // large output
  critic: "fast",          // fast analytical review
  repair: "standard",      // needs code understanding
};

/** Stage → env key for per-stage overrides */
const STAGE_ENV_KEYS: Record<ModelStage, string> = {
  reasoning: "AI_MODEL_REASONING",
  codegen: "AI_MODEL_CODEGEN",
  critic: "AI_MODEL_CRITIC",
  repair: "AI_MODEL_REPAIR",
};

/** Default temperatures per stage */
const STAGE_TEMPERATURE: Record<ModelStage, number> = {
  reasoning: 0.7,
  codegen: 0.6,
  critic: 0.3,
  repair: 0.4,
};

export interface ModelConfig {
  model: string;
  temperature: number;
}

/**
 * Resolve a model ID for the given tier, respecting env overrides first,
 * then falling back to provider-appropriate defaults.
 */
export function resolveModel(tier: ModelTier): string {
  const envKey = TIER_ENV_KEYS[tier];
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  return GEMINI_DEFAULTS[tier];
}

/**
 * Resolve model + temperature for a pipeline stage.
 * Checks stage-specific env var first, then falls back to tier default.
 */
export function resolveModelForStage(stage: ModelStage): ModelConfig {
  const envKey = STAGE_ENV_KEYS[stage];
  const envModel = process.env[envKey];
  const model = envModel || resolveModel(STAGE_TIER[stage]);
  const tempEnv = process.env[`AI_TEMP_${stage.toUpperCase()}`];
  const temperature = tempEnv ? parseFloat(tempEnv) : STAGE_TEMPERATURE[stage];
  return { model, temperature };
}

/**
 * Get a model config for a specific candidate creativity profile.
 * Used by multi-candidate generation to vary output style.
 */
export function resolveModelForCandidate(
  profile: "safe" | "balanced" | "bold",
): ModelConfig {
  const base = resolveModelForStage("codegen");
  const temperatureMap: Record<string, number> = {
    safe: 0.3,
    balanced: base.temperature,
    bold: 0.9,
  };
  return { model: base.model, temperature: temperatureMap[profile] };
}

/** Whether the current provider supports Anthropic-style tool_choice. */
export function supportsToolUse(): boolean {
  return detectCapabilities().supportsToolUse;
}

/** Whether the current provider supports cache_control on messages. */
export function supportsCacheControl(): boolean {
  return detectCapabilities().supportsCacheControl;
}

/** Re-export for convenience. */
export { detectCapabilities, type LLMCapabilities };
