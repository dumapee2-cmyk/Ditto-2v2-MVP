/**
 * Event Bus — typed EventEmitter for decoupled message routing.
 *
 * Every incoming iMessage is classified and emitted as a typed event.
 * Features register handlers for events they care about, keeping the
 * main runtime thin and each feature self-contained.
 */
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface IncomingMessageEvent {
  sender: string;          // phone number or email
  text: string;
  attachments: Array<{ filename: string; mime_type: string; transfer_name: string }>;
  chatId: string;
  isGroup: boolean;
  timestamp: Date;
}

export interface TapbackEvent {
  sender: string;
  chatId: string;
  /** The GUID of the message the tapback was applied to */
  associatedMessageGuid: string;
  /** IMCore tapback type: 2000=heart, 2001=thumbsup, 2002=haha, 2003=!!, 2004=??, 2005=thumbsdown */
  tapbackType: number;
  /** Human-readable name */
  tapbackName: "heart" | "thumbsup" | "haha" | "exclamation" | "question" | "thumbsdown";
  timestamp: Date;
}

export interface ShortcutResponseEvent {
  sender: string;
  action: string;
  result: Record<string, unknown>;
  timestamp: Date;
}

export interface GroupMessageEvent extends IncomingMessageEvent {
  /** All participants in the group */
  participants: string[];
  /** Whether the agent was directly mentioned */
  mentionsAgent: boolean;
}

export interface OutgoingMessageEvent {
  to: string;
  text: string;
  attachmentPath?: string;
}

export interface ProactiveEvent {
  jobId: string;
  userPhone: string;
  agentId: string;
  type: string;
  config: Record<string, unknown>;
}

export interface SubscriptionUpdateEvent {
  subscriptionId: string;
  userPhone: string;
  agentId: string;
  type: string;
  previousState: Record<string, unknown> | null;
  currentState: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event map — maps event names to payload types
// ---------------------------------------------------------------------------

export interface Bit7Events {
  "message:incoming": IncomingMessageEvent;
  "message:tapback": TapbackEvent;
  "message:group": GroupMessageEvent;
  "message:shortcut_response": ShortcutResponseEvent;
  "message:outgoing": OutgoingMessageEvent;
  "proactive:trigger": ProactiveEvent;
  "subscription:update": SubscriptionUpdateEvent;
}

export type Bit7EventName = keyof Bit7Events;

// ---------------------------------------------------------------------------
// Typed Event Bus
// ---------------------------------------------------------------------------

class Bit7EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners — features each register their own
    this.emitter.setMaxListeners(50);
  }

  on<E extends Bit7EventName>(event: E, handler: (payload: Bit7Events[E]) => void | Promise<void>): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  once<E extends Bit7EventName>(event: E, handler: (payload: Bit7Events[E]) => void | Promise<void>): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  off<E extends Bit7EventName>(event: E, handler: (payload: Bit7Events[E]) => void | Promise<void>): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  emit<E extends Bit7EventName>(event: E, payload: Bit7Events[E]): void {
    this.emitter.emit(event, payload);
  }

  /**
   * Wait for a specific event that matches a predicate, with a timeout.
   * Useful for request-response patterns (e.g., waiting for BIT7_RESP).
   */
  waitFor<E extends Bit7EventName>(
    event: E,
    predicate: (payload: Bit7Events[E]) => boolean,
    timeoutMs: number = 10_000,
  ): Promise<Bit7Events[E] | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const handler = (payload: Bit7Events[E]) => {
        if (!resolved && predicate(payload)) {
          resolved = true;
          this.off(event, handler);
          resolve(payload);
        }
      };

      this.on(event, handler);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.off(event, handler);
          resolve(null);
        }
      }, timeoutMs);
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton — import { eventBus } from "./eventBus.js"
// ---------------------------------------------------------------------------

export const eventBus = new Bit7EventBus();

// ---------------------------------------------------------------------------
// Helpers — classify incoming messages
// ---------------------------------------------------------------------------

/** IMCore associated_message_type values for tapbacks */
export const TAPBACK_TYPE_MAP: Record<number, TapbackEvent["tapbackName"]> = {
  2000: "heart",
  2001: "thumbsup",
  2002: "haha",
  2003: "exclamation",
  2004: "question",
  2005: "thumbsdown",
  // Removal variants (3000-3005) — we ignore these for now
};

/**
 * Classify a raw iMessage and emit the appropriate event.
 * Called by the message watcher in imessageClient.ts.
 */
export function classifyAndEmit(raw: {
  sender: string;
  text: string;
  attachments: IncomingMessageEvent["attachments"];
  chatId: string;
  isGroup: boolean;
  associatedMessageGuid?: string;
  associatedMessageType?: number;
  participants?: string[];
  timestamp: Date;
}): Bit7EventName | null {
  const { sender, text, chatId, associatedMessageGuid, associatedMessageType } = raw;

  // 1. Tapback reaction
  if (associatedMessageGuid && associatedMessageType != null) {
    const tapbackName = TAPBACK_TYPE_MAP[associatedMessageType];
    if (tapbackName) {
      eventBus.emit("message:tapback", {
        sender,
        chatId,
        associatedMessageGuid,
        tapbackType: associatedMessageType,
        tapbackName,
        timestamp: raw.timestamp,
      });
      return "message:tapback";
    }
    // Tapback removal (3000-3005) — ignore
    return null;
  }

  // 2. Shortcut response
  if (text.startsWith("BIT7_RESP:")) {
    try {
      const json = JSON.parse(text.slice("BIT7_RESP:".length));
      eventBus.emit("message:shortcut_response", {
        sender,
        action: json.action ?? "unknown",
        result: json.result ?? json,
        timestamp: raw.timestamp,
      });
      return "message:shortcut_response";
    } catch {
      console.warn("[EventBus] Failed to parse BIT7_RESP:", text.slice(0, 80));
    }
  }

  // 3. Group message
  if (raw.isGroup) {
    const mentionsAgent = /\b(bit7|@bit7|hey bit7)\b/i.test(text);
    eventBus.emit("message:group", {
      sender,
      text,
      attachments: raw.attachments,
      chatId,
      isGroup: true,
      participants: raw.participants ?? [],
      mentionsAgent,
      timestamp: raw.timestamp,
    });
    return "message:group";
  }

  // 4. Regular direct message
  eventBus.emit("message:incoming", {
    sender,
    text,
    attachments: raw.attachments,
    chatId,
    isGroup: false,
    timestamp: raw.timestamp,
  });
  return "message:incoming";
}
