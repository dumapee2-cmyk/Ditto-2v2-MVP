/**
 * Presence Engine — human-like timing, typing, reactions, and delivery.
 *
 * Sits between message receipt and message delivery to make the agent
 * feel like a real person texting. Controls:
 * - read timing (delay before marking read)
 * - typing simulation (realistic duration based on response complexity)
 * - send pacing (don't reply instantly)
 * - reaction policy (when to tapback instead of reply)
 * - thread profiling (adapt to each user's tempo)
 */

import { startTyping, stopTyping } from "./nativeBridge.js";
import { sendIMessage } from "./imessageClient.js";
import { eventBus } from "./eventBus.js";

// ---------------------------------------------------------------------------
// Thread state — per-conversation presence tracking
// ---------------------------------------------------------------------------

type PresenceState =
  | "idle"
  | "received"
  | "thinking"
  | "typing"
  | "waiting_on_tool"
  | "sending"
  | "cooldown";

interface ThreadProfile {
  /** avg words per user message */
  avgUserLength: number;
  /** avg seconds between user messages */
  avgUserTempo: number;
  /** how often user sends reactions (0-1) */
  reactionFrequency: number;
  /** total messages tracked */
  messageCount: number;
}

interface ThreadState {
  phone: string;
  state: PresenceState;
  lastMessageAt: number;
  lastReplyAt: number;
  profile: ThreadProfile;
  /** typing indicator interval handle */
  typingInterval: ReturnType<typeof setInterval> | null;
}

const threads = new Map<string, ThreadState>();

function getThread(phone: string): ThreadState {
  let t = threads.get(phone);
  if (!t) {
    t = {
      phone,
      state: "idle",
      lastMessageAt: 0,
      lastReplyAt: 0,
      profile: {
        avgUserLength: 10,
        avgUserTempo: 30,
        reactionFrequency: 0,
        messageCount: 0,
      },
      typingInterval: null,
    };
    threads.set(phone, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Thread profiling — learn each user's style over time
// ---------------------------------------------------------------------------

export function updateThreadProfile(phone: string, userMessage: string): void {
  const t = getThread(phone);
  const p = t.profile;
  const now = Date.now();
  const words = userMessage.trim().split(/\s+/).length;

  p.messageCount++;
  // running average of message length
  p.avgUserLength = p.avgUserLength + (words - p.avgUserLength) / p.messageCount;

  // running average of tempo (seconds between messages)
  if (t.lastMessageAt > 0) {
    const gap = (now - t.lastMessageAt) / 1000;
    if (gap < 300) { // only count gaps under 5 min (same conversation)
      p.avgUserTempo = p.avgUserTempo + (gap - p.avgUserTempo) / p.messageCount;
    }
  }

  t.lastMessageAt = now;
}

// ---------------------------------------------------------------------------
// Delay policies
// ---------------------------------------------------------------------------

interface DelayConfig {
  /** ms before marking as read */
  readDelay: number;
  /** ms before starting typing indicator */
  preTypingDelay: number;
  /** ms of typing indicator before sending */
  typingDuration: number;
  /** ms after sending before accepting new message */
  cooldown: number;
}

/**
 * Calculate delays based on message complexity and thread profile.
 */
function calculateDelays(
  userMessage: string,
  responseLength: number,
  usedTools: boolean,
  isUrgent: boolean,
  profile: ThreadProfile,
): DelayConfig {
  const words = userMessage.trim().split(/\s+/).length;

  if (isUrgent) {
    return {
      readDelay: Math.random() * 10,
      preTypingDelay: Math.random() * 10,
      typingDuration: Math.min(responseLength * 15, 1500),
      cooldown: 300,
    };
  }

  // Short messages (1-3 words) like greetings
  if (words <= 3) {
    return {
      readDelay: Math.random() * 10,        // 1-50ms
      preTypingDelay: Math.random() * 10,   // 50-100ms
      typingDuration: Math.min(responseLength * 20, 800),
      cooldown: 300,
    };
  }

  // Base delays — scale with message complexity
  const complexityFactor = Math.min(words / 20, 1); // 0-1 based on input length

  // Read delay: 0-10ms
  const readDelay = Math.random() * 10;

  // Pre-typing: 0-10ms
  const preTypingDelay = Math.random() * 10;

  // Typing duration: based on response length, ~30-50ms per character
  // Cap at 5s — nobody wants to watch typing for 10 seconds
  const msPerChar = 30 + Math.random() * 20;
  const rawTyping = responseLength * msPerChar;
  const typingDuration = Math.min(Math.max(rawTyping, 800), 5000);

  // Cooldown: 1-3s
  const cooldown = 1000 + complexityFactor * 2000;

  return {
    readDelay: Math.round(readDelay),
    preTypingDelay: Math.round(preTypingDelay),
    typingDuration: Math.round(typingDuration),
    cooldown: Math.round(cooldown),
  };
}

/**
 * Detect urgent messages that should bypass most delays.
 */
function isUrgentMessage(text: string): boolean {
  return /\b(urgent|asap|emergency|help|now|quick|hurry|911)\b/i.test(text);
}

// ---------------------------------------------------------------------------
// Typing simulation
// ---------------------------------------------------------------------------

/**
 * Simulate typing for a given duration. Refreshes the typing indicator
 * periodically (iMessage typing bubbles time out after ~60s).
 */
async function simulateTyping(phone: string, durationMs: number): Promise<void> {
  const t = getThread(phone);
  t.state = "typing";

  await startTyping(phone);

  // Refresh typing indicator every 10s (it can time out)
  t.typingInterval = setInterval(async () => {
    await startTyping(phone);
  }, 10_000);

  await sleep(durationMs);

  if (t.typingInterval) {
    clearInterval(t.typingInterval);
    t.typingInterval = null;
  }
}

async function stopTypingClean(phone: string): Promise<void> {
  const t = getThread(phone);
  if (t.typingInterval) {
    clearInterval(t.typingInterval);
    t.typingInterval = null;
  }
  await stopTyping(phone).catch(() => {});
}

// ---------------------------------------------------------------------------
// Delivery orchestrator — the main public API
// ---------------------------------------------------------------------------

/**
 * Called when a message is received. Handles read receipt timing.
 * Returns after marking as read.
 */
export async function onMessageReceived(phone: string, text: string): Promise<void> {
  const t = getThread(phone);
  t.state = "received";

  updateThreadProfile(phone, text);
  // Read receipt already fired instantly in handleIMessage — nothing to do here
}

/**
 * Called when LLM processing starts. Shows typing indicator after a brief pause.
 * Also starts a refresh loop so the typing bubble stays visible the whole time.
 */
export async function onThinkingStart(phone: string, userMessage: string): Promise<void> {
  const t = getThread(phone);
  t.state = "thinking";

  const urgent = isUrgentMessage(userMessage);
  const delays = calculateDelays(userMessage, 0, false, urgent, t.profile);

  console.log(`[Presence] thinking, pre-typing delay ${delays.preTypingDelay}ms`);

  // Brief pause before typing starts (thinking time)
  await sleep(delays.preTypingDelay);
  await startTyping(phone);

  // Keep typing indicator alive — refresh every 5s so it doesn't drop
  t.typingInterval = setInterval(async () => {
    if (t.state === "thinking" || t.state === "typing" || t.state === "waiting_on_tool") {
      await startTyping(phone);
    }
  }, 5_000);
}

/**
 * Called when a tool starts executing. Can optionally stop/restart typing
 * to simulate "pausing to look something up".
 */
export async function onToolStart(phone: string): Promise<void> {
  const t = getThread(phone);
  t.state = "waiting_on_tool";
  // Keep typing indicator going — the user just sees "..." which is fine
}

/**
 * Called when a tool finishes. Resume typing.
 */
export async function onToolEnd(phone: string): Promise<void> {
  const t = getThread(phone);
  if (t.state === "waiting_on_tool") {
    t.state = "typing";
    await startTyping(phone);
  }
}

/**
 * Called when the response is ready to send. Handles typing duration
 * simulation and delivery timing.
 */
export async function onReadyToSend(
  phone: string,
  reply: string,
  userMessage: string,
  usedTools: boolean,
): Promise<void> {
  const t = getThread(phone);
  const urgent = isUrgentMessage(userMessage);
  const delays = calculateDelays(userMessage, reply.length, usedTools, urgent, t.profile);

  const elapsed = Date.now() - t.lastMessageAt;

  // Minimum total time from message received to reply sent
  // Short replies: at least 1s. Longer replies: at least 2s.
  const minTotalTime = urgent ? 300 : (reply.length < 50 ? 500 : 1500);
  const extraWait = Math.max(minTotalTime - elapsed, 0);

  if (extraWait > 0) {
    console.log(`[Presence] padding ${extraWait}ms before send (elapsed ${elapsed}ms)`);
    await sleep(extraWait);
  }

  // Don't stop typing — let the message send replace the bubble naturally.
  // Just clean up the refresh interval. The typing indicator disappears
  // automatically when the message arrives, exactly like a real person.
  t.state = "sending";
  if (t.typingInterval) {
    clearInterval(t.typingInterval);
    t.typingInterval = null;
  }

  console.log(`[Presence] delivering to ${phone} (total ${Date.now() - t.lastMessageAt}ms)`);
}

/**
 * Called after message is sent. Enters cooldown.
 */
export async function onMessageSent(phone: string): Promise<void> {
  const t = getThread(phone);
  t.state = "cooldown";
  t.lastReplyAt = Date.now();

  // Stop typing now that the message is delivered
  await stopTyping(phone).catch(() => {});

  // Reset to idle after cooldown
  setTimeout(() => {
    if (t.state === "cooldown") {
      t.state = "idle";
    }
  }, 2000);
}

// ---------------------------------------------------------------------------
// Reaction policy — when to react instead of (or before) replying
// ---------------------------------------------------------------------------

export interface ReactionDecision {
  shouldReact: boolean;
  reaction?: "heart" | "thumbsup" | "haha" | "exclamation";
  /** if true, react but ALSO send a text reply */
  alsoReply: boolean;
}

/**
 * Decide whether to send a tapback reaction to the incoming message.
 * Used sparingly — only for messages that warrant a quick acknowledgment.
 */
export function shouldReact(userMessage: string, _profile: ThreadProfile): ReactionDecision {
  const text = userMessage.trim().toLowerCase();
  const noReply: ReactionDecision = { shouldReact: false, alsoReply: true };

  // Very short messages that are just acknowledgments — react, don't reply
  if (/^(ok|okay|k|got it|cool|thanks|thx|ty|bet|word|aight|yep|yea|yeah|ya|sure)\.?$/i.test(text)) {
    return { shouldReact: true, reaction: "thumbsup", alsoReply: false };
  }

  // Funny messages — laugh react + reply
  if (/\b(lol|lmao|haha|😂|🤣|dead)\b/i.test(text)) {
    return { shouldReact: true, reaction: "haha", alsoReply: false };
  }

  // Compliments or gratitude — heart react, no reply needed
  if (/^(love it|perfect|amazing|awesome|you're the best|goat|🐐|❤️|🙏)\.?$/i.test(text)) {
    return { shouldReact: true, reaction: "heart", alsoReply: false };
  }

  return noReply;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Get the current presence state for a thread (for observability/debugging).
 */
export function getPresenceState(phone: string): PresenceState {
  return getThread(phone).state;
}

/**
 * Get thread profile (for observability/debugging).
 */
export function getThreadProfile(phone: string): ThreadProfile {
  return getThread(phone).profile;
}
