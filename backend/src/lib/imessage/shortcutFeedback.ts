/**
 * Shortcut Feedback — bidirectional communication with iPhone via iMessage.
 *
 * Current system: Mac sends BIT7_CMD:{json} → iPhone Shortcut executes.
 * New system:     iPhone sends BIT7_RESP:{json} → Mac parses & stores telemetry.
 *
 * This creates a full sensor feedback loop:
 * - Battery level, WiFi network, location, now playing, health data
 * - Request-response pattern for on-demand queries
 * - Ambient telemetry feeds the context engine
 */
import type { ShortcutResponseEvent } from "./eventBus.js";
import { eventBus } from "./eventBus.js";
import { prisma } from "../db.js";
import { sendIMessage } from "./imessageClient.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceContext {
  battery?: number;
  wifi?: string;
  location?: { lat: number; lng: number; name?: string };
  now_playing?: string;
  steps?: number;
  heart_rate?: number;
  screen_time?: number;
  last_updated?: string;
}

// ---------------------------------------------------------------------------
// Telemetry storage
// ---------------------------------------------------------------------------

/**
 * Store device telemetry from a BIT7_RESP message into UserState.data.device_context.
 */
async function storeDeviceTelemetry(
  userPhone: string,
  agentId: string,
  telemetry: Record<string, unknown>,
): Promise<void> {
  const userState = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
  });

  if (!userState) return;

  const data = (userState.data as Record<string, unknown>) ?? {};
  data.device_context = {
    ...(data.device_context as Record<string, unknown> ?? {}),
    ...telemetry,
    last_updated: new Date().toISOString(),
  };

  await prisma.userState.update({
    where: { id: userState.id },
    data: { data: JSON.parse(JSON.stringify(data)) },
  });

  console.log(`[ShortcutFeedback] Stored telemetry for ${userPhone}:`, Object.keys(telemetry).join(", "));
}

/**
 * Get the latest device context for a user.
 */
export async function getDeviceContext(
  userPhone: string,
  agentId: string,
): Promise<DeviceContext | null> {
  const userState = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
  });

  if (!userState) return null;

  const data = userState.data as Record<string, unknown>;
  return (data.device_context as DeviceContext) ?? null;
}

// ---------------------------------------------------------------------------
// Request-response pattern
// ---------------------------------------------------------------------------

/**
 * Send a command to the user's iPhone and wait for the response.
 * Uses the event bus's waitFor() to block until BIT7_RESP arrives or timeout.
 *
 * @param userPhone - The user's phone number
 * @param action - The command action (e.g., "get_location", "get_health")
 * @param params - Additional parameters for the command
 * @param timeoutMs - How long to wait for a response (default 10s)
 * @returns The response result, or null if timed out
 */
export async function requestFromPhone(
  userPhone: string,
  action: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = 10_000,
): Promise<Record<string, unknown> | null> {
  const command = JSON.stringify({ action, params });
  const message = `BIT7_CMD:${command}`;

  // Send the command
  await sendIMessage(userPhone, message);

  // Wait for matching response
  const response = await eventBus.waitFor(
    "message:shortcut_response",
    (event) => event.sender === userPhone && event.action === action,
    timeoutMs,
  );

  if (!response) {
    console.log(`[ShortcutFeedback] Timeout waiting for ${action} from ${userPhone}`);
    return null;
  }

  return response.result;
}

// ---------------------------------------------------------------------------
// Response handler
// ---------------------------------------------------------------------------

/**
 * Handle incoming BIT7_RESP messages from the iPhone.
 */
async function handleShortcutResponse(event: ShortcutResponseEvent): Promise<void> {
  const agentId = process.env.IMESSAGE_AGENT_ID;
  if (!agentId) return;

  console.log(`[ShortcutFeedback] Received ${event.action} from ${event.sender}`);

  switch (event.action) {
    case "status":
    case "telemetry":
      // General device telemetry update
      await storeDeviceTelemetry(event.sender, agentId, event.result);
      break;

    case "location":
      // Location-specific response
      await storeDeviceTelemetry(event.sender, agentId, {
        location: event.result,
      });
      break;

    case "health":
      // Health data response
      await storeDeviceTelemetry(event.sender, agentId, {
        steps: event.result.steps,
        heart_rate: event.result.heart_rate,
        active_calories: event.result.active_calories,
      });
      break;

    case "now_playing":
      await storeDeviceTelemetry(event.sender, agentId, {
        now_playing: event.result.title
          ? `${event.result.title} - ${event.result.artist}`
          : event.result.now_playing,
      });
      break;

    case "battery":
      await storeDeviceTelemetry(event.sender, agentId, {
        battery: event.result.level ?? event.result.battery,
        charging: event.result.charging,
      });
      break;

    default:
      // Store any unknown response type as generic telemetry
      await storeDeviceTelemetry(event.sender, agentId, event.result);
      break;
  }
}

// ---------------------------------------------------------------------------
// Context builder helper
// ---------------------------------------------------------------------------

/**
 * Build human-readable context lines from device telemetry.
 * Called by contextEngine.ts to inject into the system prompt.
 */
export function formatDeviceContext(ctx: DeviceContext): string[] {
  const lines: string[] = [];

  if (ctx.battery != null) {
    const level = ctx.battery;
    if (level <= 15) {
      lines.push(`iPhone battery critically low: ${level}% — offer to help conserve battery or enable low power mode.`);
    } else if (level <= 30) {
      lines.push(`iPhone battery: ${level}% (getting low).`);
    }
  }

  if (ctx.wifi) {
    lines.push(`Connected to WiFi: "${ctx.wifi}".`);
  }

  if (ctx.location?.name) {
    lines.push(`User is at: ${ctx.location.name}.`);
  } else if (ctx.location?.lat) {
    lines.push(`User location: ${ctx.location.lat.toFixed(4)}, ${ctx.location.lng.toFixed(4)}.`);
  }

  if (ctx.now_playing) {
    lines.push(`Currently listening to: ${ctx.now_playing}.`);
  }

  if (ctx.steps != null) {
    lines.push(`Steps today: ${ctx.steps.toLocaleString()}.`);
  }

  if (ctx.heart_rate != null) {
    lines.push(`Heart rate: ${ctx.heart_rate} bpm.`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the shortcut feedback handler on the event bus.
 */
export function registerShortcutFeedback(): void {
  eventBus.on("message:shortcut_response", handleShortcutResponse);
  console.log("[ShortcutFeedback] Handler registered");
}
