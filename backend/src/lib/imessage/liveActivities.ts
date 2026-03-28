/**
 * Live Activities — subscription-based tracking with periodic iMessage updates.
 *
 * Simulates iOS Live Activities through periodic text updates:
 * - Package tracking: scrape carrier pages
 * - Sports scores: web search for live scores
 * - Flight status: web search for flight info
 * - Timers: countdown messages
 *
 * Each subscription polls at an interval and sends updates when state changes.
 */
import type { SubscriptionUpdateEvent } from "./eventBus.js";
import { eventBus } from "./eventBus.js";
import { prisma } from "../db.js";
import { sendIMessage } from "./imessageClient.js";
import { saveMessage, incrementConversationCount } from "../conversationState.js";
import { richSearch } from "../webSearch.js";
import { executeBrowser } from "../browser/browserSession.js";

// ---------------------------------------------------------------------------
// Tracker implementations
// ---------------------------------------------------------------------------

interface TrackingResult {
  status: string;
  details: string;
  emoji: string;
  completed: boolean;
}

/**
 * Check package tracking status.
 * Uses web search to find the latest status — works for USPS, UPS, FedEx, etc.
 */
async function checkPackage(config: Record<string, unknown>): Promise<TrackingResult> {
  const trackingNumber = config.tracking_number as string;
  const carrier = config.carrier as string | undefined;

  try {
    const query = carrier
      ? `${carrier} tracking ${trackingNumber} status`
      : `package tracking ${trackingNumber} status`;

    const { results } = await richSearch(query, { maxResults: 2, searchDepth: "basic" });
    if (results.length === 0) {
      return { status: "unknown", details: "Could not find tracking info.", emoji: "📦", completed: false };
    }

    const text = results.map((r) => r.content).join(" ");

    // Detect common statuses
    const delivered = /delivered|signed for|left at|received by/i.test(text);
    const outForDelivery = /out for delivery|on the truck|arriving today/i.test(text);
    const inTransit = /in transit|departed|arrived at|processed/i.test(text);

    if (delivered) {
      return { status: "delivered", details: "Your package has been delivered!", emoji: "✅", completed: true };
    }
    if (outForDelivery) {
      return { status: "out_for_delivery", details: "Out for delivery — arriving today!", emoji: "🚚", completed: false };
    }
    if (inTransit) {
      const snippet = text.slice(0, 100);
      return { status: "in_transit", details: snippet, emoji: "📦", completed: false };
    }

    return { status: "processing", details: text.slice(0, 100), emoji: "📦", completed: false };
  } catch {
    return { status: "error", details: "Tracking check failed.", emoji: "❓", completed: false };
  }
}

/**
 * Check sports score.
 */
async function checkSports(config: Record<string, unknown>): Promise<TrackingResult> {
  const team = config.team as string;
  const game = config.game as string | undefined;

  try {
    const query = game ?? `${team} score today live`;
    const { results } = await richSearch(query, { maxResults: 2, searchDepth: "basic" });

    if (results.length === 0) {
      return { status: "no_data", details: "No score found.", emoji: "🏈", completed: false };
    }

    const text = results[0].content.slice(0, 150);
    const isFinal = /final|ended|full.?time|game over/i.test(text);

    return {
      status: isFinal ? "final" : "live",
      details: text,
      emoji: isFinal ? "🏆" : "🏈",
      completed: isFinal,
    };
  } catch {
    return { status: "error", details: "Score check failed.", emoji: "❓", completed: false };
  }
}

/**
 * Check flight status.
 */
async function checkFlight(config: Record<string, unknown>): Promise<TrackingResult> {
  const flightNumber = config.flight_number as string;

  try {
    const { results } = await richSearch(`${flightNumber} flight status today`, {
      maxResults: 2,
      searchDepth: "basic",
    });

    if (results.length === 0) {
      return { status: "no_data", details: "No flight info found.", emoji: "✈️", completed: false };
    }

    const text = results[0].content.slice(0, 150);
    const landed = /landed|arrived|on time.*arrived/i.test(text);
    const delayed = /delayed|late/i.test(text);
    const cancelled = /cancelled|canceled/i.test(text);

    if (landed) {
      return { status: "landed", details: "Your flight has landed!", emoji: "🛬", completed: true };
    }
    if (cancelled) {
      return { status: "cancelled", details: text, emoji: "❌", completed: true };
    }
    if (delayed) {
      return { status: "delayed", details: text, emoji: "⚠️", completed: false };
    }

    return { status: "on_time", details: text, emoji: "✈️", completed: false };
  } catch {
    return { status: "error", details: "Flight check failed.", emoji: "❓", completed: false };
  }
}

/**
 * Timer countdown.
 */
async function checkTimer(config: Record<string, unknown>): Promise<TrackingResult> {
  const endTime = new Date(config.end_time as string);
  const label = (config.label as string) ?? "Timer";
  const remaining = endTime.getTime() - Date.now();

  if (remaining <= 0) {
    return { status: "done", details: `${label} — time's up!`, emoji: "⏰", completed: true };
  }

  const mins = Math.ceil(remaining / 60_000);
  if (mins > 60) {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return { status: "running", details: `${label} — ${hours}h ${remMins}m remaining`, emoji: "⏱", completed: false };
  }

  return { status: "running", details: `${label} — ${mins} min remaining`, emoji: "⏱", completed: false };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const CHECKERS: Record<string, (config: Record<string, unknown>) => Promise<TrackingResult>> = {
  package: checkPackage,
  sports: checkSports,
  flight: checkFlight,
  timer: checkTimer,
};

async function handleSubscriptionUpdate(event: SubscriptionUpdateEvent): Promise<void> {
  const checker = CHECKERS[event.type];
  if (!checker) {
    console.warn(`[LiveActivity] Unknown subscription type: ${event.type}`);
    return;
  }

  // Get the subscription config
  const sub = await prisma.subscription.findUnique({
    where: { id: event.subscriptionId },
  });
  if (!sub || sub.status !== "active") return;

  const config = sub.config as Record<string, unknown>;

  try {
    const result = await checker(config);

    // Compare with previous state — only send update if something changed
    const prevStatus = (sub.last_state as Record<string, unknown> | null)?.status;
    if (prevStatus === result.status && !result.completed) {
      // No change — skip update
      return;
    }

    // Send the update message
    const message = `${result.emoji} ${result.details}`;
    await saveMessage(event.agentId, event.userPhone, "agent", message);
    await incrementConversationCount(event.agentId, event.userPhone);
    await sendIMessage(event.userPhone, message);

    // Update the subscription state
    await prisma.subscription.update({
      where: { id: event.subscriptionId },
      data: {
        last_state: { status: result.status, details: result.details },
        status: result.completed ? "completed" : "active",
      },
    });

    console.log(`[LiveActivity] ${event.type} update for ${event.userPhone}: ${result.status}`);

    if (result.completed) {
      console.log(`[LiveActivity] ${event.type} subscription completed for ${event.userPhone}`);
    }
  } catch (e) {
    console.error(`[LiveActivity] Error checking ${event.type}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Subscription creation helpers
// ---------------------------------------------------------------------------

/**
 * Start tracking a package.
 */
export async function trackPackage(
  userPhone: string,
  agentId: string,
  trackingNumber: string,
  carrier?: string,
): Promise<string> {
  await prisma.subscription.create({
    data: {
      user_phone: userPhone,
      agent_id: agentId,
      type: "package",
      config: { tracking_number: trackingNumber, carrier },
      interval_ms: 30 * 60_000, // Check every 30 min
    },
  });
  return `Tracking ${carrier ? carrier + " " : ""}package ${trackingNumber}. I'll send updates when the status changes.`;
}

/**
 * Start tracking sports scores.
 */
export async function trackSports(
  userPhone: string,
  agentId: string,
  team: string,
  game?: string,
): Promise<string> {
  await prisma.subscription.create({
    data: {
      user_phone: userPhone,
      agent_id: agentId,
      type: "sports",
      config: { team, game },
      interval_ms: 5 * 60_000, // Check every 5 min during games
    },
  });
  return `Following ${team} scores. I'll send live updates!`;
}

/**
 * Start tracking a flight.
 */
export async function trackFlight(
  userPhone: string,
  agentId: string,
  flightNumber: string,
): Promise<string> {
  await prisma.subscription.create({
    data: {
      user_phone: userPhone,
      agent_id: agentId,
      type: "flight",
      config: { flight_number: flightNumber },
      interval_ms: 15 * 60_000, // Check every 15 min
    },
  });
  return `Tracking flight ${flightNumber}. I'll alert you on delays, gate changes, and landing.`;
}

/**
 * Start a timer.
 */
export async function startTimer(
  userPhone: string,
  agentId: string,
  minutes: number,
  label?: string,
): Promise<string> {
  const endTime = new Date(Date.now() + minutes * 60_000);
  await prisma.subscription.create({
    data: {
      user_phone: userPhone,
      agent_id: agentId,
      type: "timer",
      config: { end_time: endTime.toISOString(), label: label ?? "Timer" },
      // Update frequency: every minute for short timers, every 5 min for long ones
      interval_ms: minutes <= 10 ? 60_000 : 5 * 60_000,
    },
  });
  return `Timer set for ${minutes} minutes${label ? ` (${label})` : ""}. I'll let you know when it's done!`;
}

/**
 * Cancel all active subscriptions for a user.
 */
export async function cancelTracking(
  userPhone: string,
  agentId: string,
  type?: string,
): Promise<number> {
  const where: Record<string, unknown> = {
    user_phone: userPhone,
    agent_id: agentId,
    status: "active",
  };
  if (type) where.type = type;

  const result = await prisma.subscription.updateMany({
    where,
    data: { status: "completed" },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerLiveActivities(): void {
  eventBus.on("subscription:update", handleSubscriptionUpdate);
  console.log("[LiveActivity] Handler registered");
}
