/**
 * Tapback Handler — turns iMessage tapback reactions into semantic actions.
 *
 * When a user reacts to a message with 👍❤️😂❗❓👎, this handler
 * maps the reaction + original message context into an actionable command.
 *
 * Tapback types (from IMCore associated_message_type):
 *   2000 = ❤️ heart    → favorite / save
 *   2001 = 👍 thumbsup → confirm / book it / yes
 *   2002 = 😂 haha     → acknowledge (no action)
 *   2003 = ❗ !!        → urgent / set priority reminder
 *   2004 = ❓ ??        → elaborate / tell me more
 *   2005 = 👎 thumbsdown → reject / next option / try again
 */
import type { TapbackEvent } from "./eventBus.js";
import { eventBus } from "./eventBus.js";
import { sendIMessage } from "./imessageClient.js";
import { prisma } from "../db.js";
import { saveMessage, incrementConversationCount } from "../conversationState.js";
import { getRawLLMClient } from "../unifiedClient.js";
import { recallMemories } from "./memoryEngine.js";

// ---------------------------------------------------------------------------
// Tapback → Action mapping
// ---------------------------------------------------------------------------

interface TapbackAction {
  type: "confirm" | "favorite" | "urgent" | "elaborate" | "reject" | "acknowledge";
  description: string;
}

const TAPBACK_ACTIONS: Record<TapbackEvent["tapbackName"], TapbackAction> = {
  thumbsup: { type: "confirm", description: "User confirmed / wants to proceed" },
  heart: { type: "favorite", description: "User wants to save / favorite this" },
  haha: { type: "acknowledge", description: "User acknowledged, no action needed" },
  exclamation: { type: "urgent", description: "User marked this as urgent / priority" },
  question: { type: "elaborate", description: "User wants more details" },
  thumbsdown: { type: "reject", description: "User wants a different option / try again" },
};

// ---------------------------------------------------------------------------
// Original message lookup
// ---------------------------------------------------------------------------

/**
 * Look up the original message content that was tapbacked.
 * Queries the Conversation table by searching for messages near the tapback time.
 * Falls back to a generic description if not found.
 */
async function getOriginalMessage(
  agentId: string,
  userPhone: string,
  _associatedGuid: string,
): Promise<string | null> {
  // The associated GUID is from chat.db, but our Conversation table doesn't store GUIDs.
  // Strategy: get the most recent agent message as the likely tapback target.
  const recentAgentMsg = await prisma.conversation.findFirst({
    where: { agent_id: agentId, user_phone: userPhone, role: "agent" },
    orderBy: { created_at: "desc" },
  });

  return recentAgentMsg?.content ?? null;
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function handleConfirm(
  agentId: string,
  userPhone: string,
  originalMessage: string,
): Promise<string> {
  // Use LLM to understand what to confirm based on the original message
  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 150,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "The user gave a 👍 thumbs up to the following message, meaning they want to confirm/proceed. " +
          "Reply with a brief (1 sentence) confirmation of what you'll do next. " +
          "If the message suggested a place/restaurant, confirm you'll help book/save it. " +
          "If it was a plan/event, confirm it's set. If unclear, just acknowledge positively.",
      },
      { role: "user", content: `Message they 👍'd: "${originalMessage}"` },
    ],
  });

  return completion.choices[0]?.message?.content ?? "Got it! 👍";
}

async function handleFavorite(
  agentId: string,
  userPhone: string,
  originalMessage: string,
): Promise<string> {
  // Save to memory as a favorite
  await prisma.memory.create({
    data: {
      user_phone: userPhone,
      agent_id: agentId,
      type: "preference",
      key: "favorite_item",
      value: originalMessage.slice(0, 200),
      confidence: 0.9,
      source: "tapback_heart",
    },
  });

  return "Saved to your favorites ❤️";
}

async function handleUrgent(
  agentId: string,
  userPhone: string,
  originalMessage: string,
): Promise<string> {
  // Extract actionable item and create a high-priority reminder
  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 100,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          'The user marked this message as urgent (❗). Extract the key action or reminder in a short phrase. Reply with ONLY the reminder text, nothing else.',
      },
      { role: "user", content: originalMessage },
    ],
  });

  const reminderText = completion.choices[0]?.message?.content ?? originalMessage.slice(0, 80);

  // Store as a high-priority memory
  await prisma.memory.create({
    data: {
      user_phone: userPhone,
      agent_id: agentId,
      type: "episodic",
      key: "urgent_reminder",
      value: reminderText,
      confidence: 1.0,
      source: "tapback_exclamation",
    },
  });

  return `Marked as urgent: "${reminderText}" ❗`;
}

async function handleElaborate(
  agentId: string,
  userPhone: string,
  originalMessage: string,
): Promise<string> {
  // Get more details about the original message
  const memories = await recallMemories(userPhone, agentId, originalMessage);
  const memoryContext = memories.length > 0
    ? `\nUser memories: ${memories.map((m) => m.value).join("; ")}`
    : "";

  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 300,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "The user reacted with ❓ to your previous message, wanting more details. " +
          "Expand on the original message with 2-3 sentences of useful additional info. " +
          "Be specific and helpful." + memoryContext,
      },
      { role: "user", content: `Elaborate on: "${originalMessage}"` },
    ],
  });

  return completion.choices[0]?.message?.content ?? "Here's more detail...";
}

async function handleReject(
  agentId: string,
  userPhone: string,
  originalMessage: string,
): Promise<string> {
  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 200,
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content:
          "The user gave a 👎 to your previous message, meaning they want a different option or approach. " +
          "Offer an alternative in 1-2 sentences. Be creative — don't repeat the same suggestion.",
      },
      { role: "user", content: `They rejected: "${originalMessage}". Give a different suggestion.` },
    ],
  });

  return completion.choices[0]?.message?.content ?? "Let me try a different approach...";
}

// ---------------------------------------------------------------------------
// Main handler — registered on the event bus
// ---------------------------------------------------------------------------

/**
 * Process a tapback event. Looks up the original message, determines
 * the semantic action, executes it, and sends a response.
 */
async function handleTapback(event: TapbackEvent): Promise<void> {
  const agentId = process.env.IMESSAGE_AGENT_ID;
  if (!agentId) return;

  const action = TAPBACK_ACTIONS[event.tapbackName];
  if (!action) return;

  // Skip acknowledgments — no response needed
  if (action.type === "acknowledge") {
    console.log(`[Tapback] 😂 from ${event.sender} — acknowledged, no action`);
    return;
  }

  const originalMessage = await getOriginalMessage(agentId, event.sender, event.associatedMessageGuid);
  if (!originalMessage) {
    console.warn(`[Tapback] Could not find original message for GUID ${event.associatedMessageGuid}`);
    return;
  }

  console.log(`[Tapback] ${event.tapbackName} from ${event.sender} on: "${originalMessage.slice(0, 50)}"`);

  let reply: string;
  try {
    switch (action.type) {
      case "confirm":
        reply = await handleConfirm(agentId, event.sender, originalMessage);
        break;
      case "favorite":
        reply = await handleFavorite(agentId, event.sender, originalMessage);
        break;
      case "urgent":
        reply = await handleUrgent(agentId, event.sender, originalMessage);
        break;
      case "elaborate":
        reply = await handleElaborate(agentId, event.sender, originalMessage);
        break;
      case "reject":
        reply = await handleReject(agentId, event.sender, originalMessage);
        break;
      default:
        return;
    }
  } catch (e) {
    console.error(`[Tapback] Error handling ${action.type}:`, e);
    return;
  }

  // Send reply and save to conversation
  await saveMessage(agentId, event.sender, "agent", reply);
  await incrementConversationCount(agentId, event.sender);
  await sendIMessage(event.sender, reply);
  console.log(`[Tapback] Replied to ${event.sender}: "${reply.slice(0, 50)}"`);
}

// ---------------------------------------------------------------------------
// Registration — call once at startup
// ---------------------------------------------------------------------------

/**
 * Register the tapback handler on the event bus.
 */
export function registerTapbackHandler(): void {
  eventBus.on("message:tapback", handleTapback);
  console.log("[Tapback] Handler registered");
}
