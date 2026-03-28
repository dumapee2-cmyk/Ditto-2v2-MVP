/**
 * Context Engine — builds ambient context for the iMessage agent system prompt.
 * Gathers time awareness, conversation patterns, tone hints, and connected services.
 */
import { prisma } from "../db.js";
import { getLocationString } from "./areaCodeLocation.js";
import { getDeviceContext, formatDeviceContext } from "./shortcutFeedback.js";
import { injectMemories } from "./memoryEngine.js";

const LA_TZ = "America/Los_Angeles";

function getTimeContext(now: Date): {
  timeStr: string;
  dayOfWeek: string;
  partOfDay: string;
  isWeekend: boolean;
} {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: LA_TZ }).format(now);

  const hour = parseInt(fmt({ hour: "numeric", hour12: false }), 10);
  const dayOfWeek = fmt({ weekday: "long" });
  const timeStr = fmt({ hour: "numeric", minute: "2-digit", hour12: true });
  const isWeekend = dayOfWeek === "Saturday" || dayOfWeek === "Sunday";

  let partOfDay: string;
  if (hour >= 5 && hour < 12) partOfDay = "morning";
  else if (hour >= 12 && hour < 17) partOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) partOfDay = "evening";
  else partOfDay = "night";

  return { timeStr, dayOfWeek, partOfDay, isWeekend };
}

interface ConversationPatterns {
  totalConversations: number;
  isNewUser: boolean;
  daysSinceFirstMessage: number;
  hoursSinceLastMessage: number | null;
  peakHour: number | null;
}

async function getConversationPatterns(
  userPhone: string,
  agentId: string,
): Promise<ConversationPatterns> {
  // Run all 3 queries in parallel instead of sequentially
  const [userState, firstMessage, recentMessages] = await Promise.all([
    prisma.userState.findUnique({
      where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
    }),
    prisma.conversation.findFirst({
      where: { agent_id: agentId, user_phone: userPhone, role: "user" },
      orderBy: { created_at: "asc" },
      select: { created_at: true },
    }),
    prisma.conversation.findMany({
      where: { agent_id: agentId, user_phone: userPhone, role: "user" },
      orderBy: { created_at: "desc" },
      take: 100,
      select: { created_at: true },
    }),
  ]);

  const totalConversations = userState?.conversation_count ?? 0;
  const lastActive = userState?.last_active ?? null;

  const now = new Date();
  const daysSinceFirstMessage = firstMessage
    ? Math.floor((now.getTime() - firstMessage.created_at.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const hoursSinceLastMessage = lastActive
    ? (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60)
    : null;

  let peakHour: number | null = null;
  if (recentMessages.length >= 5) {
    const hourCounts = new Array<number>(24).fill(0);
    for (const msg of recentMessages) {
      const h = parseInt(
        new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          hour12: false,
          timeZone: LA_TZ,
        }).format(msg.created_at),
        10,
      );
      hourCounts[h]++;
    }
    peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  }

  return {
    totalConversations,
    isNewUser: totalConversations <= 2,
    daysSinceFirstMessage,
    hoursSinceLastMessage,
    peakHour,
  };
}

function buildToneHints(
  partOfDay: string,
  isWeekend: boolean,
  patterns: ConversationPatterns,
): string {
  const hints: string[] = [];

  if (patterns.isNewUser) {
    hints.push("New user — be warm but not overwhelming.");
  } else if (
    patterns.hoursSinceLastMessage !== null &&
    patterns.hoursSinceLastMessage > 72
  ) {
    hints.push("Returning after a while — welcome them back naturally.");
  }

  if (partOfDay === "morning") {
    hints.push("Morning — user may ask about schedule or email.");
  } else if (partOfDay === "night") {
    hints.push("Late night — keep responses brief, user is likely winding down.");
  }

  if (isWeekend) {
    hints.push("Weekend — more casual tone, likely personal requests.");
  }

  return hints.join(" ");
}

async function getConnectedServices(userPhone: string): Promise<string[]> {
  const tokens = await prisma.oAuthToken.findMany({
    where: { user_phone: userPhone },
    select: { service: true },
  });
  return tokens.map((t) => t.service);
}

export async function buildContextBlock(
  userPhone: string,
  agentId: string,
): Promise<string> {
  const now = new Date();
  const { timeStr, dayOfWeek, partOfDay, isWeekend } = getTimeContext(now);

  // Run ALL independent queries in parallel
  const [patterns, services, deviceCtx, memoryCount, activeSubs] = await Promise.all([
    getConversationPatterns(userPhone, agentId),
    getConnectedServices(userPhone),
    getDeviceContext(userPhone, agentId),
    prisma.memory.count({ where: { user_phone: userPhone, agent_id: agentId } }),
    prisma.subscription.findMany({
      where: { user_phone: userPhone, agent_id: agentId, status: "active" },
      select: { type: true, config: true },
    }),
  ]);

  const lines: string[] = [];

  // Time awareness
  lines.push(
    `Current time: ${timeStr} ${dayOfWeek} (${partOfDay}${isWeekend ? ", weekend" : ""}).`,
  );

  // Conversation patterns
  if (patterns.isNewUser) {
    lines.push("This is a new user (first few conversations).");
  } else {
    lines.push(
      `Returning user — ${patterns.totalConversations} conversations over ${patterns.daysSinceFirstMessage} days.`,
    );
  }

  if (
    patterns.hoursSinceLastMessage !== null &&
    patterns.hoursSinceLastMessage > 72
  ) {
    const days = Math.floor(patterns.hoursSinceLastMessage / 24);
    lines.push(`Haven't heard from them in ${days} days.`);
  }

  // Peak hour insight
  if (patterns.peakHour !== null) {
    const label =
      patterns.peakHour < 12
        ? "morning person"
        : patterns.peakHour >= 21
          ? "night owl"
          : "daytime texter";
    lines.push(`Messaging pattern: ${label}.`);
  }

  // Tone hints
  const toneHints = buildToneHints(partOfDay, isWeekend, patterns);
  if (toneHints) {
    lines.push(toneHints);
  }

  // User location — prefer stored GPS, fall back to area code
  const userData = (await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
    select: { data: true },
  }))?.data as Record<string, unknown> | null;
  const storedLoc = userData?.location as { lat: number; lng: number; updated_at: string } | undefined;
  if (storedLoc?.lat && storedLoc?.lng) {
    lines.push(`User location (GPS): ${storedLoc.lat}, ${storedLoc.lng}. Use these coordinates for weather, restaurants, directions, etc.`);
  } else {
    const userLocation = getLocationString(userPhone);
    if (userLocation) {
      lines.push(`User location (from area code): ${userLocation}. Use this for weather, restaurants, directions, etc. For more precise results, ask the user to share their location.`);
    }
  }

  // Calendar awareness
  const hasCalendar = services.some(
    (s) => s.toLowerCase() === "icloud",
  );
  if (hasCalendar) {
    lines.push(
      "User has calendar connected — can reference their schedule.",
    );
  }

  // Connected services
  if (services.length > 0) {
    const display = services.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    lines.push(`Connected services: ${display.join(", ")}. Can suggest using these proactively.`);
  }

  // Device telemetry from Shortcuts feedback loop
  if (deviceCtx) {
    const deviceLines = formatDeviceContext(deviceCtx);
    if (deviceLines.length > 0) {
      lines.push("--- DEVICE STATUS ---");
      lines.push(...deviceLines);
    }
  }

  // Long-term memory
  if (memoryCount > 0) {
    lines.push(`You have ${memoryCount} memories about this user. They are injected in the MEMORIES section below.`);
  }

  // Active subscriptions (live tracking)
  if (activeSubs.length > 0) {
    const subDesc = activeSubs.map((s) => {
      const cfg = s.config as Record<string, unknown>;
      switch (s.type) {
        case "package": return `tracking package ${cfg.tracking_number}`;
        case "flight": return `tracking flight ${cfg.flight_number}`;
        case "sports": return `following ${cfg.team}`;
        case "timer": return `timer: ${cfg.label ?? "active"}`;
        default: return s.type;
      }
    });
    lines.push(`Active tracking: ${subDesc.join(", ")}.`);
  }

  return `--- AMBIENT CONTEXT ---\n${lines.join("\n")}`;
}

/**
 * Build the full context including memories for a specific message.
 * Combines ambient context + relevant memories for the current conversation.
 */
export async function buildFullContext(
  userPhone: string,
  agentId: string,
  currentMessage: string,
): Promise<string> {
  const [ambientCtx, memoryCtx] = await Promise.all([
    buildContextBlock(userPhone, agentId),
    injectMemories(userPhone, agentId, currentMessage),
  ]);

  return memoryCtx ? `${ambientCtx}\n\n${memoryCtx}` : ambientCtx;
}
