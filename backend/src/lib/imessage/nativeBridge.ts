/**
 * Native Bridge — Node.js client for the Bit7Bridge HTTP API + AppleScript typing.
 *
 * Typing indicators use AppleScript to type a character in Messages.app,
 * which triggers the real native "..." bubble on the recipient's device.
 * Read receipts use the Bit7Bridge HTTP API (IMCore).
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://localhost:5050";
let _available: boolean | null = null;

/** Track which chat is currently "typing" so we don't double-trigger */
const typingState = new Map<string, boolean>();

/**
 * Build iMessage chat identifier from phone number or email.
 */
function buildChatId(phoneOrEmail: string): string {
  if (phoneOrEmail.startsWith("iMessage;")) return phoneOrEmail;
  return `iMessage;-;${phoneOrEmail}`;
}

/**
 * Make a request to the bridge. Returns true if successful.
 */
async function bridgeRequest(
  path: string,
  body?: Record<string, unknown>,
): Promise<boolean> {
  try {
    const resp = await fetch(`${BRIDGE_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Check if the native bridge is available.
 */
export async function isBridgeAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  _available = await bridgeRequest("/health");
  if (_available) {
    console.log("[NativeBridge] Connected to Bit7Bridge on", BRIDGE_URL);
  } else {
    console.log("[NativeBridge] Bridge not available — native features disabled");
  }
  return _available;
}

/**
 * Reset the availability cache (e.g., after bridge restart).
 */
export function resetAvailability(): void {
  _available = null;
}

const TYPING_URL = process.env.TYPING_URL ?? "http://localhost:5055";

/**
 * Start showing the typing indicator via TypingInjector dylib inside Messages.app.
 * Calls setLocalUserIsTyping:YES on the IMChat object — works for any chat simultaneously.
 */
export async function startTyping(phoneOrEmail: string): Promise<void> {
  if (typingState.get(phoneOrEmail)) return;
  typingState.set(phoneOrEmail, true);

  try {
    const res = await fetch(`${TYPING_URL}/typing/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: phoneOrEmail }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[NativeBridge] Typing started for ${phoneOrEmail}`);
  } catch (e) {
    console.warn(`[NativeBridge] startTyping failed:`, e instanceof Error ? e.message : e);
    typingState.set(phoneOrEmail, false);
  }
}

/**
 * Stop the typing indicator via TypingInjector dylib.
 */
export async function stopTyping(phoneOrEmail: string): Promise<void> {
  if (!typingState.get(phoneOrEmail)) return;
  typingState.set(phoneOrEmail, false);

  try {
    const res = await fetch(`${TYPING_URL}/typing/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: phoneOrEmail }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[NativeBridge] Typing stopped for ${phoneOrEmail}`);
  } catch (e) {
    console.warn(`[NativeBridge] stopTyping failed:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Mark messages as read. Uses both TypingInjector (IMCore) and AppleScript
 * together — either alone is delayed, both together flush instantly.
 */
export async function markRead(phoneOrEmail: string): Promise<void> {
  try {
    await Promise.all([
      fetch(`${TYPING_URL}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat: phoneOrEmail }),
      }),
      execFileAsync("osascript", ["-e", `
tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  set targetBuddy to buddy "${phoneOrEmail}" of targetService
end tell`], { timeout: 5000 }),
    ]);
    console.log(`[NativeBridge] Read receipt sent for ${phoneOrEmail}`);
  } catch (e) {
    console.warn(`[NativeBridge] markRead failed:`, e instanceof Error ? e.message : e);
  }
}
