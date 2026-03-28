/**
 * Agent Quality Scorer — evaluates an AgentSpec across 8 SMS-specific dimensions.
 *
 * Each dimension is scored 0-10, then weighted and normalized to a 0-100 composite.
 * Uses a fast LLM call to analyze the spec holistically, with static checks
 * as a safety net if the LLM call fails.
 */
import type { AgentSpec, QualityBreakdown } from "../types/index.js";
import { withTimeout } from "./llmTimeout.js";
import { resolveModel } from "./modelResolver.js";
import { extractJSON, extractTextFromResponse, llmLog } from "./llmCompat.js";
import { getUnifiedClient } from "./unifiedClient.js";
import { recordSpend, calculateCost } from "./costTracker.js";
import type { ProgressCallback } from "./progressEmitter.js";

const DIMENSION_WEIGHTS: Record<keyof QualityBreakdown, number> = {
  conversation_flow: 0.20,
  input_handling: 0.15,
  response_quality: 0.20,
  state_management: 0.15,
  error_recovery: 0.10,
  tool_integration: 0.10,
  personality_consistency: 0.05,
  security: 0.05,
};

const SCORER_SYSTEM = `You are an SMS agent quality evaluator. Given an AgentSpec (the runtime configuration for an SMS conversational agent), score it across 8 dimensions.

Each dimension is scored 0-10:
- 0-3: Major problems, missing or broken
- 4-6: Functional but weak, missing important aspects
- 7-8: Good, covers key cases
- 9-10: Excellent, production-ready

Dimensions:
1. **conversation_flow** (weight 20%): Multi-turn handling, context retention, greeting, farewell, natural turn-taking. Does the system prompt instruct the agent to maintain conversation context?
2. **input_handling** (weight 15%): Text parsing, photo/MMS handling, edge cases (empty messages, spam, unexpected input types). Are all declared input_types covered in the system prompt?
3. **response_quality** (weight 20%): Concise SMS-appropriate responses (under 320 chars), helpful, actionable. Does the system prompt enforce SMS length limits?
4. **state_management** (weight 15%): Per-user data persistence via STATE_UPDATE blocks, no cross-user leaks, reasonable data model design. Are the data_model fields used in the system prompt?
5. **error_recovery** (weight 10%): Graceful handling of bad input, API failures, unknown intents. Does the system prompt include fallback behaviors?
6. **tool_integration** (weight 10%): Are declared tools referenced in the system prompt? Are tool configs reasonable? Vision tool present if photo input type is declared?
7. **personality_consistency** (weight 5%): Does the system prompt maintain a consistent voice/personality? Does personality match the personality field?
8. **security** (weight 5%): No prompt injection vulnerabilities, no instructions to reveal system prompt, no cross-user data access patterns.

Respond with a JSON object containing exactly these 8 fields, each an integer 0-10. No explanation, just JSON.`;

export interface QualityScoreResult {
  score: number;
  breakdown: QualityBreakdown;
}

export async function scoreAgent(
  spec: AgentSpec,
  onProgress?: ProgressCallback,
): Promise<QualityScoreResult> {
  onProgress?.({ type: "status", message: "Scoring agent quality..." });

  try {
    return await scoreLLM(spec);
  } catch (e) {
    console.warn("[QualityScorer] LLM scoring failed, using static fallback:", e);
    return scoreStatic(spec);
  }
}

async function scoreLLM(spec: AgentSpec): Promise<QualityScoreResult> {
  const modelId = resolveModel("fast");
  llmLog("agentQualityScorer", { model: modelId });

  const client = getUnifiedClient();

  const specSummary = [
    `Name: ${spec.name}`,
    `Description: ${spec.description}`,
    `Personality: ${spec.personality}`,
    `Input types: ${spec.input_types.join(", ")}`,
    `Capabilities (${spec.capabilities.length}): ${spec.capabilities.map(c => c.name).join(", ")}`,
    `Data model fields (${spec.data_model.length}): ${spec.data_model.map(f => `${f.key}:${f.type}`).join(", ")}`,
    `Tools (${spec.tools.length}): ${spec.tools.map(t => `${t.name}:${t.type}`).join(", ")}`,
    `Welcome message: ${spec.welcome_message}`,
    `Example conversations: ${spec.example_conversations.length}`,
    ``,
    `System prompt (${spec.system_prompt.length} chars):`,
    spec.system_prompt,
  ].join("\n");

  const response = await withTimeout(
    (signal) =>
      client.messages.create(
        {
          model: modelId,
          max_tokens: 500,
          temperature: 0.1,
          system: SCORER_SYSTEM,
          messages: [{ role: "user", content: specSummary }],
        },
        { signal },
      ),
    30_000,
    "Agent quality scorer",
  );

  const usage = response.usage as { input_tokens: number; output_tokens: number };
  recordSpend(calculateCost(modelId, usage));

  const text = extractTextFromResponse(
    response.content as Array<{ type: string; text?: string; thinking?: string }>,
  );
  if (!text) throw new Error("No text in scorer response");

  const raw = JSON.parse(extractJSON(text)) as Record<string, unknown>;
  const breakdown = parseBreakdown(raw);
  const score = computeComposite(breakdown);

  return { score, breakdown };
}

function scoreStatic(spec: AgentSpec): QualityScoreResult {
  const breakdown: QualityBreakdown = {
    conversation_flow: 5,
    input_handling: 5,
    response_quality: 5,
    state_management: 5,
    error_recovery: 5,
    tool_integration: 5,
    personality_consistency: 5,
    security: 5,
  };

  const sp = spec.system_prompt.toLowerCase();

  // conversation_flow: boost if system prompt is substantial
  if (spec.system_prompt.length > 500) breakdown.conversation_flow += 1;
  if (spec.example_conversations.length >= 3) breakdown.conversation_flow += 1;
  if (sp.includes("context") || sp.includes("history") || sp.includes("conversation")) breakdown.conversation_flow += 1;

  // input_handling: check coverage
  if (spec.input_types.includes("photo") && (sp.includes("photo") || sp.includes("image") || sp.includes("mms"))) breakdown.input_handling += 1;
  if (spec.capabilities.length >= 3) breakdown.input_handling += 1;
  if (sp.includes("unexpected") || sp.includes("unknown") || sp.includes("rephrase")) breakdown.input_handling += 1;

  // response_quality: SMS constraints
  if (sp.includes("320") || sp.includes("160") || sp.includes("concise") || sp.includes("short")) breakdown.response_quality += 2;
  if (sp.includes("emoji")) breakdown.response_quality += 1;

  // state_management: STATE_UPDATE protocol
  if (sp.includes("state_update") || sp.includes("STATE_UPDATE")) breakdown.state_management += 2;
  if (spec.data_model.length > 0) breakdown.state_management += 1;

  // error_recovery
  if (sp.includes("error") || sp.includes("fail") || sp.includes("sorry")) breakdown.error_recovery += 1;
  if (sp.includes("rephrase") || sp.includes("try again") || sp.includes("didn't understand")) breakdown.error_recovery += 1;

  // tool_integration: consistency check
  if (spec.input_types.includes("photo") && spec.tools.some(t => t.type === "vision")) breakdown.tool_integration += 2;
  if (spec.tools.length > 0 && spec.tools.every(t => sp.includes(t.name) || sp.includes(t.type))) breakdown.tool_integration += 1;

  // personality_consistency
  if (spec.personality.length > 20) breakdown.personality_consistency += 1;
  if (sp.includes(spec.personality.split(" ")[0]?.toLowerCase() ?? "")) breakdown.personality_consistency += 1;

  // security
  if (sp.includes("never reveal") || sp.includes("do not share") || sp.includes("system prompt")) breakdown.security += 1;
  if (!sp.includes("ignore previous") && !sp.includes("ignore all")) breakdown.security += 1;

  // Cap all at 10
  for (const key of Object.keys(breakdown) as (keyof QualityBreakdown)[]) {
    breakdown[key] = Math.min(10, breakdown[key]);
  }

  const score = computeComposite(breakdown);
  return { score, breakdown };
}

function parseBreakdown(raw: Record<string, unknown>): QualityBreakdown {
  const clamp = (v: unknown) => Math.max(0, Math.min(10, Number(v) || 5));
  return {
    conversation_flow: clamp(raw.conversation_flow),
    input_handling: clamp(raw.input_handling),
    response_quality: clamp(raw.response_quality),
    state_management: clamp(raw.state_management),
    error_recovery: clamp(raw.error_recovery),
    tool_integration: clamp(raw.tool_integration),
    personality_consistency: clamp(raw.personality_consistency),
    security: clamp(raw.security),
  };
}

function computeComposite(breakdown: QualityBreakdown): number {
  let composite = 0;
  for (const [key, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    composite += breakdown[key as keyof QualityBreakdown] * weight;
  }
  // Normalize from 0-10 weighted to 0-100
  return Math.round(composite * 10);
}
