/**
 * iMessage Client — wraps @photon-ai/imessage-kit to provide
 * the same interface pattern as our Twilio client.
 *
 * Runs on macOS only. Reads the local iMessage database
 * and sends via AppleScript (blue bubbles).
 *
 * Uses fs.watch on chat.db for near-instant message detection (~20-50ms)
 * instead of relying solely on polling (which adds random 0-pollInterval delay).
 */
import { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Message } from "@photon-ai/imessage-kit";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type IMessageHandler = (message: Message) => Promise<void>;

let _sdk: InstanceType<typeof IMessageSDK> | null = null;
let _fsWatcher: fs.FSWatcher | null = null;

export function getIMessageSDK(): InstanceType<typeof IMessageSDK> {
  if (!_sdk) {
    _sdk = new IMessageSDK({
      debug: process.env.IMESSAGE_DEBUG === "true",
      maxConcurrent: 5,
      watcher: {
        // Fallback poll at 3s — fs.watch handles the fast path
        pollInterval: Number(process.env.IMESSAGE_POLL_INTERVAL ?? 3000),
        unreadOnly: false,
        excludeOwnMessages: true,
      },
    });
  }
  return _sdk;
}

/**
 * Send a text message via iMessage.
 */
export async function sendIMessage(to: string, body: string): Promise<void> {
  const sdk = getIMessageSDK();
  await sdk.send(to, body);
}

/**
 * Send a message with an image via iMessage.
 */
export async function sendIMessageWithImage(
  to: string,
  body: string,
  imagePath: string,
): Promise<void> {
  const sdk = getIMessageSDK();
  await sdk.send(to, { text: body, images: [imagePath] });
}

/**
 * Fetch recent incoming messages from the last N seconds (startup sweep).
 */
export async function getRecentIncoming(sinceSecs: number): Promise<Message[]> {
  const sdk = getIMessageSDK();
  const since = new Date(Date.now() - sinceSecs * 1000);
  const result = await sdk.getMessages({ since, limit: 20 });
  const msgs = (result as any).messages ?? result;
  return (msgs as Message[]).filter((m) => !m.isFromMe && !m.isReaction);
}

/**
 * Start watching for incoming iMessages.
 * Calls the handler for each new direct message.
 */
export async function startIMessageWatcher(
  onMessage: IMessageHandler,
  onError?: (error: Error) => void,
): Promise<void> {
  const sdk = getIMessageSDK();

  await sdk.startWatching({
    onDirectMessage: async (msg) => {
      // Skip reactions — we only want actual messages
      if (msg.isReaction) return;
      try {
        await onMessage(msg);
      } catch (e) {
        console.error("[iMessage] Handler error:", e);
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    },
    onError: (error) => {
      console.error("[iMessage] Watcher error:", error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });

  console.log("[iMessage] Watcher started — polling for new messages");

  // Layer fs.watch on chat.db for near-instant message detection.
  // When macOS writes a new message to chat.db, FSEvents fires within ~20-50ms.
  // We then call the SDK's watcher.check() immediately instead of waiting for the next poll.
  const chatDbPath = path.join(os.homedir(), "Library/Messages/chat.db");
  try {
    let lastCheck = 0;
    _fsWatcher = fs.watch(chatDbPath, () => {
      // Small delay lets SQLite finish writing both message + sender handle
      const now = Date.now();
      if (now - lastCheck < 50) return;
      lastCheck = now;
      setTimeout(() => {
        const watcher = (sdk as any).watcher;
        if (watcher && typeof watcher.check === "function") {
          watcher.check().catch(() => {});
        }
      }, 30);
    });
    console.log("[iMessage] fs.watch active on chat.db — near-instant message detection");
  } catch (e) {
    console.warn("[iMessage] fs.watch failed, relying on polling:", e);
  }
}

/**
 * Stop watching for messages and release resources.
 */
export async function stopIMessageWatcher(): Promise<void> {
  if (_fsWatcher) {
    _fsWatcher.close();
    _fsWatcher = null;
  }
  const sdk = getIMessageSDK();
  sdk.stopWatching();
  sdk.close();
  _sdk = null;
  console.log("[iMessage] Watcher stopped");
}

/**
 * Get conversation history with a specific user directly from iMessage chat.db.
 * Returns messages in chronological order (oldest first).
 */
export async function getChatHistory(
  userPhone: string,
  limit: number = 20,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const sdk = getIMessageSDK();
  const result = await sdk.getMessages({
    sender: userPhone,
    excludeOwnMessages: false,
    excludeReactions: true,
    limit,
  });
  const msgs = (result as any).messages ?? result;
  // Filter out empty messages, broken "functions." replies, and tool-call garbage
  const GARBAGE_PATTERN = /^functions\b|^web_search|^iphone_action|tool_call|鲁斯/i;
  return (msgs as Message[])
    .filter((m) => m.text && m.text.trim() !== "" && !GARBAGE_PATTERN.test(m.text.trim()))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((m) => ({
      role: m.isFromMe ? ("assistant" as const) : ("user" as const),
      content: m.text!,
    }));
}

export type { Message as IMessage };
