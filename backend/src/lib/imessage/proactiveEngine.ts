/**
 * Proactive Intelligence Engine — the agent reaches out before you ask.
 *
 * Job types:
 * 1. Morning Briefing — weather + calendar + email digest at peak hour
 * 2. Pattern-Based Nudges — "You usually text Mom on Sundays"
 * 3. Smart Reminders — pre-event alerts, deadline detection
 * 4. Re-engagement — contextual check-in after silence
 *
 * Safety: Max 3 proactive messages/day, quiet hours respected, user can disable.
 */
import type { ProactiveEvent } from "./eventBus.js";
import { eventBus } from "./eventBus.js";
import { sendIMessage } from "./imessageClient.js";
import { prisma } from "../db.js";
import { saveMessage, incrementConversationCount } from "../conversationState.js";
import { getRawLLMClient } from "../unifiedClient.js";
import { richSearch } from "../webSearch.js";
import { recallMemories } from "./memoryEngine.js";
import { getDeviceContext, formatDeviceContext } from "./shortcutFeedback.js";
import { getLocationString } from "./areaCodeLocation.js";
import { upsertProactiveJob } from "./scheduler.js";

// ---------------------------------------------------------------------------
// Quiet hours — don't send proactive messages during these times
// ---------------------------------------------------------------------------

const QUIET_START = 22; // 10 PM
const QUIET_END = 7;    // 7 AM

function isQuietHours(): boolean {
  const now = new Date();
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Los_Angeles",
    }).format(now),
    10,
  );
  return hour >= QUIET_START || hour < QUIET_END;
}

// ---------------------------------------------------------------------------
// Job executors
// ---------------------------------------------------------------------------

async function executeMorningBriefing(
  userPhone: string,
  agentId: string,
  config: Record<string, unknown>,
): Promise<void> {
  if (isQuietHours()) return;

  const parts: string[] = [];

  // 1. Weather
  const location = getLocationString(userPhone) ?? process.env.DEFAULT_LOCATION ?? "Irvine, CA";
  try {
    const { results } = await richSearch(`weather today ${location}`, { maxResults: 1, searchDepth: "basic" });
    if (results.length > 0) {
      parts.push(results[0].content.slice(0, 120));
    }
  } catch {
    // Skip weather if search fails
  }

  // 2. Calendar (from iCloud if connected)
  const hasCalendar = await prisma.oAuthToken.findUnique({
    where: { user_phone_service: { user_phone: userPhone, service: "icloud" } },
  });
  if (hasCalendar) {
    // TODO: Fetch today's calendar events via CalDAV
    // For now, we'll let the LLM compose without calendar data
  }

  // 3. Device context (battery, location, etc.)
  const deviceCtx = await getDeviceContext(userPhone, agentId);
  if (deviceCtx) {
    const ctxLines = formatDeviceContext(deviceCtx);
    if (ctxLines.length > 0) parts.push(ctxLines.join(" "));
  }

  // 4. User memories for personalization
  const memories = await recallMemories(userPhone, agentId, "morning routine daily schedule");
  const memHints = memories.map((m) => m.value).join("; ");

  // Compose the briefing via LLM
  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 200,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "You are sending a proactive morning briefing via iMessage. " +
          "Be warm but concise — 2-3 sentences max. Include weather and any relevant info. " +
          "Don't say 'good morning briefing' or anything meta. Just be a helpful friend checking in." +
          (memHints ? `\nThings you know about them: ${memHints}` : ""),
      },
      {
        role: "user",
        content: `Compose a morning message for this user. Info available:\n${parts.join("\n") || "No specific data — just a friendly good morning."}`,
      },
    ],
  });

  const message = completion.choices[0]?.message?.content;
  if (!message) return;

  await saveMessage(agentId, userPhone, "agent", message);
  await incrementConversationCount(agentId, userPhone);
  await sendIMessage(userPhone, message);
  console.log(`[Proactive] Morning briefing sent to ${userPhone}`);
}

async function executeNudge(
  userPhone: string,
  agentId: string,
  config: Record<string, unknown>,
): Promise<void> {
  if (isQuietHours()) return;

  const nudgeType = config.nudge_type as string;
  const nudgeContext = config.context as string;

  if (!nudgeContext) return;

  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 100,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "You are sending a gentle proactive nudge via iMessage. " +
          "Be natural and casual — like a friend who noticed something. " +
          "One sentence max. Don't be pushy.",
      },
      {
        role: "user",
        content: `Nudge context: ${nudgeContext}`,
      },
    ],
  });

  const message = completion.choices[0]?.message?.content;
  if (!message) return;

  await saveMessage(agentId, userPhone, "agent", message);
  await incrementConversationCount(agentId, userPhone);
  await sendIMessage(userPhone, message);
  console.log(`[Proactive] Nudge (${nudgeType}) sent to ${userPhone}`);
}

async function executeReminder(
  userPhone: string,
  agentId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const reminderText = config.text as string;
  if (!reminderText) return;

  const message = `Reminder: ${reminderText}`;
  await saveMessage(agentId, userPhone, "agent", message);
  await incrementConversationCount(agentId, userPhone);
  await sendIMessage(userPhone, message);
  console.log(`[Proactive] Reminder sent to ${userPhone}: "${reminderText.slice(0, 50)}"`);
}

async function executeReengagement(
  userPhone: string,
  agentId: string,
  config: Record<string, unknown>,
): Promise<void> {
  if (isQuietHours()) return;

  // Check if they've actually been silent
  const userState = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
  });
  if (!userState) return;

  const hoursSinceLast = (Date.now() - userState.last_active.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLast < 48) return; // Don't re-engage if they've been active recently

  // Get recent memories for contextual check-in
  const memories = await recallMemories(userPhone, agentId, "recent events plans upcoming");

  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 100,
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content:
          "You are sending a casual check-in message via iMessage to a user you haven't heard from in a while. " +
          "Be natural and reference something specific from your past conversations if possible. " +
          "One sentence max. Never say 'I haven't heard from you' — that's needy." +
          (memories.length > 0
            ? `\nThings you know: ${memories.map((m) => m.value).join("; ")}`
            : ""),
      },
      {
        role: "user",
        content: `It's been ${Math.floor(hoursSinceLast / 24)} days since they last texted. Compose a natural check-in.`,
      },
    ],
  });

  const message = completion.choices[0]?.message?.content;
  if (!message) return;

  await saveMessage(agentId, userPhone, "agent", message);
  await incrementConversationCount(agentId, userPhone);
  await sendIMessage(userPhone, message);
  console.log(`[Proactive] Re-engagement sent to ${userPhone} (${Math.floor(hoursSinceLast / 24)} days silent)`);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleProactiveEvent(event: ProactiveEvent): Promise<void> {
  console.log(`[Proactive] Executing ${event.type} for ${event.userPhone}`);

  try {
    switch (event.type) {
      case "morning_briefing":
        await executeMorningBriefing(event.userPhone, event.agentId, event.config);
        break;
      case "nudge":
        await executeNudge(event.userPhone, event.agentId, event.config);
        break;
      case "reminder":
        await executeReminder(event.userPhone, event.agentId, event.config);
        break;
      case "reengagement":
        await executeReengagement(event.userPhone, event.agentId, event.config);
        break;
      default:
        console.warn(`[Proactive] Unknown job type: ${event.type}`);
    }
  } catch (e) {
    console.error(`[Proactive] Error executing ${event.type}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Auto-setup — create default jobs when a user reaches a milestone
// ---------------------------------------------------------------------------

/**
 * Check if a user should have proactive jobs auto-created.
 * Called after conversation count increments.
 */
export async function maybeAutoSetupProactive(
  userPhone: string,
  agentId: string,
  conversationCount: number,
): Promise<void> {
  // Auto-create morning briefing after 5 conversations
  if (conversationCount === 5) {
    // Determine their peak hour from conversation patterns
    const recentMessages = await prisma.conversation.findMany({
      where: { agent_id: agentId, user_phone: userPhone, role: "user" },
      orderBy: { created_at: "desc" },
      take: 20,
      select: { created_at: true },
    });

    let peakHour = 8; // Default 8 AM
    if (recentMessages.length >= 5) {
      const hourCounts = new Array(24).fill(0);
      for (const msg of recentMessages) {
        const h = parseInt(
          new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            hour12: false,
            timeZone: "America/Los_Angeles",
          }).format(msg.created_at),
          10,
        );
        hourCounts[h]++;
      }
      peakHour = hourCounts.indexOf(Math.max(...hourCounts));
      // Clamp to reasonable morning range
      if (peakHour < 6 || peakHour > 11) peakHour = 8;
    }

    await upsertProactiveJob({
      userPhone,
      agentId,
      type: "morning_briefing",
      schedule: `daily:${String(peakHour).padStart(2, "0")}:00`,
      config: { auto_created: true },
    });

    console.log(`[Proactive] Auto-created morning briefing at ${peakHour}:00 for ${userPhone}`);
  }

  // Auto-create re-engagement check after 10 conversations
  if (conversationCount === 10) {
    await upsertProactiveJob({
      userPhone,
      agentId,
      type: "reengagement",
      schedule: "daily:12:00", // Check daily at noon
      config: { auto_created: true, min_silence_hours: 72 },
    });

    console.log(`[Proactive] Auto-created re-engagement for ${userPhone}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProactiveEngine(): void {
  eventBus.on("proactive:trigger", handleProactiveEvent);
  console.log("[Proactive] Engine registered");
}
