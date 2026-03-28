/**
 * Agent Runtime — the main execution engine for SMS agents.
 *
 * Flow:
 * 1. Look up agent by phone number
 * 2. Load conversation history + user state
 * 3. If MMS: download media, run through Vision API
 * 4. Build messages array (system_prompt + history + current message)
 * 5. Call GPT-4o-mini (text) or GPT-4o (vision) via OpenAI SDK
 * 6. Parse STATE_UPDATE blocks from response
 * 7. Save messages + update user state
 * 8. Return reply text
 */
import type OpenAI from "openai";
import { prisma } from "./db.js";
import {
  getOrCreateUserState,
  updateUserState,
  incrementConversationCount,
  getConversationHistory,
  saveMessage,
} from "./conversationState.js";
import { analyzeImage } from "./vision.js";
import { getBase64Image } from "./twilio/mediaHandler.js";
import { getRawLLMClient } from "./unifiedClient.js";
import { resolveModel } from "./modelResolver.js";
import type { AgentSpec, AgentConfig } from "../types/index.js";
import { DEFAULT_AGENT_CONFIG } from "../types/index.js";

export interface RuntimeResult {
  reply: string;
  agentId: string;
  agentName: string;
  stateUpdated: boolean;
}

/**
 * Handle an incoming message to an agent.
 */
export async function handleIncomingMessage(
  toPhoneNumber: string,
  fromPhone: string,
  body: string,
  mediaUrl?: string,
  mediaContentType?: string,
): Promise<RuntimeResult> {
  // 1. Look up agent by phone number
  const agent = await prisma.agent.findUnique({
    where: { phone_number: toPhoneNumber },
  });

  if (!agent || !agent.active) {
    return {
      reply: "This number is not currently active. Please try again later.",
      agentId: "",
      agentName: "System",
      stateUpdated: false,
    };
  }

  const spec = agent.spec as unknown as AgentSpec;
  const config = (agent.agent_config as unknown as AgentConfig) ?? DEFAULT_AGENT_CONFIG;

  // 2. Load conversation history + user state
  const [history, userState] = await Promise.all([
    getConversationHistory(agent.id, fromPhone, config.max_history_length),
    getOrCreateUserState(agent.id, fromPhone),
  ]);

  // Check if this is a new user (send welcome message)
  if (userState.conversation_count === 0 && !body.trim()) {
    await incrementConversationCount(agent.id, fromPhone);
    await saveMessage(agent.id, fromPhone, "agent", spec.welcome_message);
    return {
      reply: spec.welcome_message,
      agentId: agent.id,
      agentName: spec.name,
      stateUpdated: false,
    };
  }

  // 3. If MMS: analyze with Vision API
  let visionContext = "";
  if (mediaUrl && mediaContentType?.startsWith("image/")) {
    try {
      const base64 = await getBase64Image(mediaUrl, mediaContentType);
      // Build a vision prompt based on the agent's domain
      const visionPrompt = `Analyze this image in the context of: ${spec.description}. Describe what you see concisely.`;
      visionContext = await analyzeImage(base64, visionPrompt, config.vision_model);
    } catch (e) {
      console.warn("[Runtime] Vision analysis failed:", e);
      visionContext = "(Unable to process the attached image)";
    }
  }

  // 4. Build messages array
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemMessage(spec, userState.data) },
  ];

  // Add conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // Build current user message
  let currentMessage = body;
  if (visionContext) {
    currentMessage = `${body}\n\n[Photo analysis: ${visionContext}]`;
  }

  // Save incoming message
  await saveMessage(agent.id, fromPhone, "user", body, mediaUrl, mediaContentType);

  messages.push({ role: "user", content: currentMessage });

  // 5. Call LLM for response (Kimi for now, OpenAI later)
  const modelToUse = resolveModel("fast");
  const llm = getRawLLMClient();

  const completion = await llm.chat.completions.create({
    model: modelToUse,
    max_tokens: 500,
    temperature: 0.7,
    messages,
  });

  const rawReply = completion.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.";

  // 6. Parse STATE_UPDATE blocks
  const { cleanReply, stateUpdates } = parseStateUpdates(rawReply);

  // 7. Save agent reply + update state
  await saveMessage(agent.id, fromPhone, "agent", cleanReply);
  await incrementConversationCount(agent.id, fromPhone);

  let stateUpdated = false;
  if (Object.keys(stateUpdates).length > 0) {
    await updateUserState(agent.id, fromPhone, stateUpdates);
    stateUpdated = true;
  }

  return {
    reply: cleanReply,
    agentId: agent.id,
    agentName: spec.name,
    stateUpdated,
  };
}

/**
 * Test an agent without Twilio — direct LLM call for preview.
 */
export async function testAgentMessage(
  agentId: string,
  testMessage: string,
  testPhone: string = "+10000000000",
): Promise<RuntimeResult> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const spec = agent.spec as unknown as AgentSpec;
  const config = (agent.agent_config as unknown as AgentConfig) ?? DEFAULT_AGENT_CONFIG;

  // Load history for test phone
  const [history, userState] = await Promise.all([
    getConversationHistory(agentId, testPhone, config.max_history_length),
    getOrCreateUserState(agentId, testPhone),
  ]);

  // Build messages
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemMessage(spec, userState.data) },
  ];

  for (const msg of history) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  await saveMessage(agentId, testPhone, "user", testMessage);
  messages.push({ role: "user", content: testMessage });

  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: resolveModel("fast"),
    max_tokens: 500,
    temperature: 0.7,
    messages,
  });

  const rawReply = completion.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
  const { cleanReply, stateUpdates } = parseStateUpdates(rawReply);

  await saveMessage(agentId, testPhone, "agent", cleanReply);
  await incrementConversationCount(agentId, testPhone);

  let stateUpdated = false;
  if (Object.keys(stateUpdates).length > 0) {
    await updateUserState(agentId, testPhone, stateUpdates);
    stateUpdated = true;
  }

  return {
    reply: cleanReply,
    agentId,
    agentName: spec.name,
    stateUpdated,
  };
}

/**
 * Build the system message for the runtime, injecting current user state.
 */
function buildSystemMessage(
  spec: AgentSpec,
  userData: Record<string, unknown>,
): string {
  let systemMsg = spec.system_prompt;

  // Inject current user state if data model has values
  if (Object.keys(userData).length > 0) {
    systemMsg += `\n\n--- CURRENT USER DATA ---\n${JSON.stringify(userData, null, 2)}`;
  }

  return systemMsg;
}

/**
 * Parse STATE_UPDATE blocks from agent response.
 * Format: [STATE_UPDATE]{"key": "value"}[/STATE_UPDATE]
 */
function parseStateUpdates(reply: string): {
  cleanReply: string;
  stateUpdates: Record<string, unknown>;
} {
  const stateUpdates: Record<string, unknown> = {};
  const pattern = /\[STATE_UPDATE\]([\s\S]*?)\[\/STATE_UPDATE\]/g;

  let cleanReply = reply;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(reply)) !== null) {
    try {
      const updates = JSON.parse(match[1]);
      Object.assign(stateUpdates, updates);
    } catch {
      console.warn("[Runtime] Failed to parse STATE_UPDATE:", match[1]);
    }
  }

  // Remove STATE_UPDATE blocks from the reply
  cleanReply = cleanReply.replace(pattern, "").trim();

  return { cleanReply, stateUpdates };
}
