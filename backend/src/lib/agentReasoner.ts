/**
 * Agent Reasoner — extracts structured AgentIntent from a user prompt.
 * Uses Kimi K2.5 via the unified client with tool-use (JSON mode) to produce
 * a complete intent describing the SMS agent's personality, capabilities,
 * data model, and conversation examples.
 */
import type { AgentIntent, AgentCapability, InputType, DataField, ExampleConversation } from "../types/index.js";
import { withTimeout } from "./llmTimeout.js";
import { recordSpend, calculateCost } from "./costTracker.js";
import { resolveModelForStage } from "./modelResolver.js";
import { llmLog } from "./llmCompat.js";
import { getUnifiedClient } from "./unifiedClient.js";
import type { ProgressCallback } from "./progressEmitter.js";

const REASONER_SYSTEM = `You are an SMS agent architect. Given a user's description, design a complete SMS/text-message agent.

SMS agents are conversational AI services that users interact with by texting a phone number. Users send text messages (and sometimes photos via MMS) and receive text replies. There is NO visual UI — everything is text-based.

Your job is to extract a complete agent intent from the user's prompt, including:

1. **Agent Name** — short, memorable, SMS-friendly (e.g., "CalBot", "FitCoach", "BudgetBuddy")
2. **Domain** — the agent's area of expertise (e.g., "nutrition", "fitness", "finance", "learning")
3. **Personality** — how the agent talks: tone, voice, character (e.g., "friendly nutritionist who uses casual language and emoji", "strict but encouraging fitness coach")
4. **Capabilities** — what the agent can DO (each with trigger phrases users might text)
5. **Input Types** — what kinds of messages the agent handles:
   - "text" — plain text messages (always included)
   - "photo" — MMS photos (food pics, receipts, screenshots, etc.)
   - "location" — location data
   - "audio" — voice messages
6. **Data Model** — what to persist PER USER across conversations (e.g., calorie_log, workout_history, budget_entries)
7. **Example Conversations** — 2-3 realistic multi-turn SMS exchanges showing how the agent behaves
8. **Tools Needed** — what external capabilities the agent requires ("vision" for photo analysis, "web_search" for looking things up, "calculation" for math, "api_call" for external services)

SMS-specific constraints to consider:
- Messages should be concise (SMS-friendly, generally under 320 chars per reply)
- No markdown, no rich formatting — plain text with line breaks and emoji
- Multi-turn: users text back and forth, the agent remembers context
- Photos arrive as MMS — if the agent needs to analyze photos, include "photo" in input_types and "vision" in tools_needed
- The agent should handle unexpected input gracefully ("I didn't understand that, could you rephrase?")

Respond with a JSON object matching the provided schema. Be specific and creative — don't produce generic placeholders.`;

const REASONER_TOOL_SCHEMA = {
  name: "produce_agent_intent",
  description: "Produce a structured agent intent from the user's prompt",
  input_schema: {
    type: "object" as const,
    required: ["agent_name", "domain", "personality_brief", "capabilities", "input_types", "data_fields", "example_conversations", "tools_needed"],
    properties: {
      agent_name: {
        type: "string",
        description: "Short, memorable agent name (2-15 chars)",
      },
      domain: {
        type: "string",
        description: "Agent's domain of expertise (1-3 words)",
      },
      personality_brief: {
        type: "string",
        description: "How the agent communicates — tone, voice, character (1-2 sentences)",
      },
      capabilities: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "description", "trigger_phrases"],
          properties: {
            name: { type: "string", description: "Capability name (e.g., 'log_meal', 'track_workout')" },
            description: { type: "string", description: "What this capability does" },
            trigger_phrases: {
              type: "array",
              items: { type: "string" },
              description: "Example messages that trigger this capability",
            },
          },
        },
        description: "2-6 capabilities the agent has",
      },
      input_types: {
        type: "array",
        items: { type: "string", enum: ["text", "photo", "location", "audio"] },
        description: "What input types the agent handles",
      },
      data_fields: {
        type: "array",
        items: {
          type: "object",
          required: ["key", "type", "description"],
          properties: {
            key: { type: "string" },
            type: { type: "string", enum: ["string", "number", "boolean", "json", "string[]"] },
            description: { type: "string" },
          },
        },
        description: "Per-user data fields to persist across conversations",
      },
      example_conversations: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "messages"],
          properties: {
            label: { type: "string" },
            messages: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: { type: "string", enum: ["user", "agent"] },
                  content: { type: "string" },
                },
              },
            },
          },
        },
        description: "2-3 realistic example conversations",
      },
      tools_needed: {
        type: "array",
        items: { type: "string", enum: ["vision", "web_search", "calculation", "api_call"] },
        description: "External tools the agent needs",
      },
    },
  },
};

export async function reasonAgent(
  prompt: string,
  webSearchContext?: string | null,
  onProgress?: ProgressCallback,
): Promise<AgentIntent> {
  const { model: modelId, temperature } = resolveModelForStage("reasoning");
  llmLog("agentReasoner", { model: modelId });

  const client = getUnifiedClient();

  let userMessage = prompt;
  if (webSearchContext) {
    userMessage += `\n\n--- DOMAIN CONTEXT ---\n${webSearchContext}`;
  }

  onProgress?.({ type: "narrative", message: "Analyzing your agent concept..." });

  const response = await withTimeout(
    (signal) =>
      client.messages.create(
        {
          model: modelId,
          max_tokens: 4000,
          temperature,
          system: REASONER_SYSTEM,
          messages: [{ role: "user", content: userMessage }],
          tools: [REASONER_TOOL_SCHEMA],
        },
        { signal },
      ),
    120_000,
    "Agent reasoner",
  );

  // Track cost
  const usage = response.usage as { input_tokens: number; output_tokens: number };
  const cost = calculateCost(modelId, usage);
  recordSpend(cost);

  // Extract tool_use result
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (toolUse && toolUse.type === "tool_use") {
    const raw = toolUse.input as Record<string, unknown>;
    return parseAgentIntent(raw);
  }

  // Fallback: try to parse text as JSON
  const textBlock = response.content.find((b) => b.type === "text");
  if (textBlock && textBlock.type === "text") {
    try {
      const raw = JSON.parse(textBlock.text);
      return parseAgentIntent(raw);
    } catch {
      // Fall through to fallback
    }
  }

  console.warn("[AgentReasoner] Could not extract structured intent, using fallback");
  return buildFallbackIntent(prompt);
}

function parseAgentIntent(raw: Record<string, unknown>): AgentIntent {
  return {
    agent_name: String(raw.agent_name ?? "SMS Agent").slice(0, 50),
    domain: String(raw.domain ?? "general").slice(0, 100),
    personality_brief: String(raw.personality_brief ?? "A helpful SMS assistant").slice(0, 500),
    capabilities: Array.isArray(raw.capabilities)
      ? (raw.capabilities as AgentCapability[]).slice(0, 8)
      : [],
    input_types: Array.isArray(raw.input_types)
      ? (raw.input_types as InputType[]).filter(t => ["text", "photo", "location", "audio"].includes(t))
      : ["text"],
    data_fields: Array.isArray(raw.data_fields)
      ? (raw.data_fields as DataField[]).slice(0, 20)
      : [],
    example_conversations: Array.isArray(raw.example_conversations)
      ? (raw.example_conversations as ExampleConversation[]).slice(0, 5)
      : [],
    tools_needed: Array.isArray(raw.tools_needed)
      ? (raw.tools_needed as string[]).filter(t => ["vision", "web_search", "calculation", "api_call"].includes(t))
      : [],
  };
}

function buildFallbackIntent(prompt: string): AgentIntent {
  const words = prompt.trim().split(/\s+/).slice(0, 3).join(" ");
  return {
    agent_name: `${words} Agent`.slice(0, 30),
    domain: "general",
    personality_brief: "A helpful and friendly SMS assistant that responds concisely",
    capabilities: [
      {
        name: "respond",
        description: "Respond to user messages with helpful information",
        trigger_phrases: ["help", "hi", "hello"],
      },
    ],
    input_types: ["text"],
    data_fields: [],
    example_conversations: [
      {
        label: "Basic greeting",
        messages: [
          { role: "user", content: "Hi" },
          { role: "agent", content: `Hey! I'm your SMS assistant. ${prompt.slice(0, 100)}. How can I help?` },
        ],
      },
    ],
    tools_needed: [],
  };
}
