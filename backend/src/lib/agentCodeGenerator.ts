/**
 * Agent Code Generator — takes an AgentIntent and produces a complete AgentSpec.
 * The AgentSpec is the runtime configuration that drives the SMS agent:
 * system prompt, personality, capabilities, data model, tools, and examples.
 *
 * Uses Kimi K2.5 to generate a production-quality system prompt and
 * conversation design from the structured intent.
 */
import type { AgentSpec, AgentIntent, AgentTool, AgentConfig } from "../types/index.js";
import { DEFAULT_AGENT_CONFIG } from "../types/index.js";
import { withTimeout } from "./llmTimeout.js";
import { recordSpend, calculateCost } from "./costTracker.js";
import { resolveModelForStage, resolveModelForCandidate } from "./modelResolver.js";
import { llmLog } from "./llmCompat.js";
import { getUnifiedClient } from "./unifiedClient.js";
import type { ProgressCallback } from "./progressEmitter.js";
import type { CandidateId } from "../types/index.js";

const CODEGEN_SYSTEM = `You are an expert SMS agent designer. Given a structured agent intent, produce a complete agent specification that will power a production SMS agent.

The agent spec you produce will be interpreted by a runtime engine that:
1. Receives incoming SMS/MMS messages via Twilio
2. Loads the user's conversation history and persistent state
3. Sends the system_prompt + history + current message to GPT-4o-mini (or GPT-4o for photos)
4. Sends the response back as an SMS
5. Updates the user's persistent state

Your job is to produce:

1. **system_prompt** — The runtime system prompt that GPT-4o-mini will use. This is the MOST IMPORTANT field. It should:
   - Define the agent's personality, tone, and communication style
   - List ALL capabilities with clear instructions for when/how to use each
   - Define the data model and how to update it (using structured JSON in a special STATE_UPDATE block)
   - Include SMS-specific instructions: keep responses under 320 chars, use plain text + emoji, no markdown
   - Include error handling: what to say for unknown input, photos when not expected, etc.
   - Include state management instructions: how to read from and write to the user's persistent data
   - Use this format for state updates: include a JSON block tagged [STATE_UPDATE]{"key": "value"}[/STATE_UPDATE] in the response when state needs to change. The runtime will parse and apply this.

2. **welcome_message** — First message sent when a new user texts the agent (under 160 chars)

3. **personality** — A concise personality description

4. **capabilities** — The agent's capabilities (carried from intent, may be refined)

5. **tools** — Tool definitions with configs:
   - vision: { "type": "vision", "description": "Analyze photos with GPT-4o", "config": { "detail": "auto" } }
   - web_search: { "type": "web_search", "description": "Search the web", "config": {} }
   - calculation: { "type": "calculation", "description": "Perform calculations", "config": {} }
   - api_call: { "type": "api_call", "description": "Call external APIs", "config": { "endpoint": "" } }

6. **example_conversations** — 3-5 realistic multi-turn conversations showing the agent in action, including state updates

7. **data_model** — Per-user persistent fields (carried from intent, may be refined with defaults)

Respond with a JSON object matching the provided schema. Make the system_prompt detailed and production-ready — this is what actually runs.`;

const CODEGEN_TOOL_SCHEMA = {
  name: "produce_agent_spec",
  description: "Produce a complete agent specification for the SMS runtime",
  input_schema: {
    type: "object" as const,
    required: ["name", "description", "personality", "system_prompt", "welcome_message", "capabilities", "input_types", "data_model", "example_conversations", "tools"],
    properties: {
      name: { type: "string", description: "Agent display name" },
      description: { type: "string", description: "One-line description of the agent" },
      personality: { type: "string", description: "Personality description (1-2 sentences)" },
      system_prompt: { type: "string", description: "Complete runtime system prompt for GPT-4o-mini (500-2000 chars)" },
      welcome_message: { type: "string", description: "First message for new users (under 160 chars)" },
      capabilities: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "description", "trigger_phrases"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            trigger_phrases: { type: "array", items: { type: "string" } },
          },
        },
      },
      input_types: {
        type: "array",
        items: { type: "string", enum: ["text", "photo", "location", "audio"] },
      },
      data_model: {
        type: "array",
        items: {
          type: "object",
          required: ["key", "type", "description"],
          properties: {
            key: { type: "string" },
            type: { type: "string", enum: ["string", "number", "boolean", "json", "string[]"] },
            description: { type: "string" },
            default_value: {},
          },
        },
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
      },
      tools: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "type", "description", "config"],
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["vision", "web_search", "api_call", "calculation"] },
            description: { type: "string" },
            config: { type: "object" },
          },
        },
      },
    },
  },
};

export interface AgentCodeGenResult {
  spec: AgentSpec;
  config: AgentConfig;
  candidateId: CandidateId;
  rawCode: string;
}

/**
 * Generate a single agent spec from an intent.
 */
export async function generateAgentSpec(
  intent: AgentIntent,
  candidateProfile: CandidateId = "balanced",
  onProgress?: ProgressCallback,
): Promise<AgentCodeGenResult> {
  const { model: modelId, temperature } = resolveModelForCandidate(candidateProfile);
  llmLog("agentCodeGen", { model: modelId, candidate: candidateProfile, temperature });

  const client = getUnifiedClient();

  const userMessage = buildUserMessage(intent, candidateProfile);

  onProgress?.({ type: "status", message: `Generating ${candidateProfile} agent variant...` });

  const response = await withTimeout(
    (signal) =>
      client.messages.create(
        {
          model: modelId,
          max_tokens: 8000,
          temperature,
          system: CODEGEN_SYSTEM,
          messages: [{ role: "user", content: userMessage }],
          tools: [CODEGEN_TOOL_SCHEMA],
        },
        { signal },
      ),
    180_000,
    `Agent code gen (${candidateProfile})`,
  );

  // Track cost
  const usage = response.usage as { input_tokens: number; output_tokens: number };
  const cost = calculateCost(modelId, usage);
  recordSpend(cost);

  // Extract result
  const toolUse = response.content.find((b) => b.type === "tool_use");
  let raw: Record<string, unknown>;

  if (toolUse && toolUse.type === "tool_use") {
    raw = toolUse.input as Record<string, unknown>;
  } else {
    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text") {
      try {
        raw = JSON.parse(textBlock.text);
      } catch {
        console.warn(`[AgentCodeGen] ${candidateProfile}: could not parse response, using fallback`);
        return buildFallbackResult(intent, candidateProfile);
      }
    } else {
      return buildFallbackResult(intent, candidateProfile);
    }
  }

  const spec = parseAgentSpec(raw, intent);
  const rawCode = JSON.stringify(spec, null, 2);

  return {
    spec,
    config: DEFAULT_AGENT_CONFIG,
    candidateId: candidateProfile,
    rawCode,
  };
}

/**
 * Generate multiple candidate specs in parallel (multi-candidate mode).
 */
export async function generateMultipleCandidates(
  intent: AgentIntent,
  count: 1 | 2 | 3,
  onProgress?: ProgressCallback,
): Promise<AgentCodeGenResult[]> {
  const profiles: CandidateId[] = count === 1
    ? ["balanced"]
    : count === 2
      ? ["safe", "bold"]
      : ["safe", "balanced", "bold"];

  onProgress?.({ type: "status", message: `Generating ${count} agent variant${count > 1 ? "s" : ""}...` });

  const results = await Promise.all(
    profiles.map((profile) => generateAgentSpec(intent, profile, onProgress)),
  );

  return results;
}

function buildUserMessage(intent: AgentIntent, profile: CandidateId): string {
  const profileGuidance: Record<CandidateId, string> = {
    safe: "Generate a CONSERVATIVE agent: simple capabilities, straightforward personality, minimal data model. Focus on reliability and clarity.",
    balanced: "Generate a BALANCED agent: well-rounded capabilities, natural personality, appropriate data model. Balance functionality with simplicity.",
    bold: "Generate a CREATIVE agent: rich capabilities, distinctive personality, comprehensive data model. Push boundaries on what an SMS agent can do.",
  };

  return [
    `## Agent Intent`,
    `Name: ${intent.agent_name}`,
    `Domain: ${intent.domain}`,
    `Personality: ${intent.personality_brief}`,
    ``,
    `### Capabilities`,
    ...intent.capabilities.map((c, i) => `${i + 1}. **${c.name}**: ${c.description} (triggers: ${c.trigger_phrases.join(", ")})`),
    ``,
    `### Input Types: ${intent.input_types.join(", ")}`,
    ``,
    `### Data Fields`,
    ...intent.data_fields.map((f) => `- ${f.key} (${f.type}): ${f.description}`),
    ``,
    `### Tools Needed: ${intent.tools_needed.join(", ") || "none"}`,
    ``,
    `### Example Conversations`,
    ...intent.example_conversations.map((ex) => [
      `**${ex.label}:**`,
      ...ex.messages.map((m) => `  ${m.role === "user" ? "👤" : "🤖"} ${m.content}`),
    ].join("\n")),
    ``,
    `## Generation Profile`,
    profileGuidance[profile],
  ].join("\n");
}

function parseAgentSpec(raw: Record<string, unknown>, intent: AgentIntent): AgentSpec {
  const tools: AgentTool[] = Array.isArray(raw.tools)
    ? (raw.tools as AgentTool[]).map((t) => ({
        name: String(t.name ?? ""),
        type: t.type as AgentTool["type"],
        description: String(t.description ?? ""),
        config: (t.config as Record<string, unknown>) ?? {},
      }))
    : intent.tools_needed.map((t) => ({
        name: t,
        type: t as AgentTool["type"],
        description: `${t} tool`,
        config: {},
      }));

  return {
    schema_version: "1",
    name: String(raw.name ?? intent.agent_name).slice(0, 100),
    description: String(raw.description ?? `SMS agent for ${intent.domain}`).slice(0, 500),
    personality: String(raw.personality ?? intent.personality_brief).slice(0, 500),
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities as AgentSpec["capabilities"] : intent.capabilities,
    input_types: Array.isArray(raw.input_types)
      ? (raw.input_types as AgentSpec["input_types"]).filter(t => ["text", "photo", "location", "audio"].includes(t))
      : intent.input_types,
    data_model: Array.isArray(raw.data_model) ? raw.data_model as AgentSpec["data_model"] : intent.data_fields,
    example_conversations: Array.isArray(raw.example_conversations) ? raw.example_conversations as AgentSpec["example_conversations"] : intent.example_conversations,
    tools,
    system_prompt: String(raw.system_prompt ?? `You are ${intent.agent_name}.`),
    welcome_message: String(raw.welcome_message ?? `Hi! I'm ${intent.agent_name}. Text me anytime!`).slice(0, 320),
  };
}

function buildFallbackResult(intent: AgentIntent, candidateId: CandidateId): AgentCodeGenResult {
  const spec: AgentSpec = {
    schema_version: "1",
    name: intent.agent_name,
    description: `SMS agent for ${intent.domain}`,
    personality: intent.personality_brief,
    capabilities: intent.capabilities,
    input_types: intent.input_types,
    data_model: intent.data_fields,
    example_conversations: intent.example_conversations,
    tools: intent.tools_needed.map((t) => ({
      name: t,
      type: t as AgentTool["type"],
      description: `${t} tool`,
      config: {},
    })),
    system_prompt: [
      `You are ${intent.agent_name}, ${intent.personality_brief}.`,
      ``,
      `You communicate via SMS. Keep responses under 320 characters. Use plain text and emoji. No markdown.`,
      ``,
      `Your capabilities:`,
      ...intent.capabilities.map((c) => `- ${c.name}: ${c.description}`),
      ``,
      `If you don't understand a message, ask the user to rephrase.`,
    ].join("\n"),
    welcome_message: `Hi! I'm ${intent.agent_name} 👋 ${intent.capabilities[0]?.description ?? "How can I help?"}`.slice(0, 160),
  };

  return {
    spec,
    config: DEFAULT_AGENT_CONFIG,
    candidateId,
    rawCode: JSON.stringify(spec, null, 2),
  };
}
