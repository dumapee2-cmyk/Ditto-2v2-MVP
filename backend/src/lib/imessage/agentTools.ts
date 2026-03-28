/**
 * Agent Tools — tool definitions and executors for the agentic loop.
 *
 * Strategy: Composio for third-party APIs (Spotify, Gmail, Calendar, etc.),
 * native macOS/iCloud for on-device actions, headless browser as fallback.
 */
import { richSearch } from "../webSearch.js";
import { addCalendarEvent, setReminder } from "./icloudCalDAV.js";
import { lookupContact } from "./icloudContacts.js";
import { sendIMessage } from "./imessageClient.js";
import { getLocationString } from "./areaCodeLocation.js";
import { sendLocationPin, sendCalendarInvite, sendVoiceNote, sendImage } from "./richMedia.js";
import { executeBrowser } from "../browser/browserSession.js";
import { prisma } from "../db.js";
import { trackPackage, trackSports, trackFlight, startTimer, cancelTracking } from "./liveActivities.js";
import { generateDeepLink, getSupportedApps } from "./deepLinks.js";
import { generateAndSendDocument } from "./documentPipeline.js";
import { forgetAll, listMemories } from "./memoryEngine.js";
import { createUserSession } from "../composio.js";

/** Get contacts synced from the iOS Shortcut (stored in userState.data) */
async function getSyncedContacts(userPhone?: string): Promise<Array<{ name: string; phones?: string[]; emails?: string[] }> | null> {
  if (!userPhone) return null;
  const agentId = process.env.IMESSAGE_AGENT_ID;
  if (!agentId) return null;
  const state = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
    select: { data: true },
  });
  const data = state?.data as Record<string, unknown> | null;
  return (data?.contacts as Array<{ name: string; phones?: string[]; emails?: string[] }>) ?? null;
}

// Pending location pins — queued during web search, sent after the reply
const _pendingPin = new Map<string, { name: string; address: string; lat: number; lng: number }>();

/** Send any queued location pin for this user. Call after the reply is sent. */
export async function flushPendingLocationPin(userPhone: string): Promise<void> {
  const pin = _pendingPin.get(userPhone);
  if (!pin) return;
  _pendingPin.delete(userPhone);
  try {
    await sendLocationPin(userPhone, pin.name, pin.address, pin.lat, pin.lng);
    console.log(`[iMessage] Location pin sent after reply: ${pin.name} (${pin.lat}, ${pin.lng})`);
  } catch (e) {
    console.warn("[iMessage] Failed to send queued location pin:", e);
  }
}

// Tool routing — maps keywords to tool names so we only send relevant tools to the LLM
const TOOL_KEYWORDS: Record<string, string[]> = {
  web_search: ["weather", "search", "news", "score", "price", "how", "what", "who", "when", "where", "why", "forecast", "temperature"],
  iphone_action: ["calendar", "event", "reminder", "remind"],
  lookup_contact: ["text", "message", "contact", "send to", "call", "phone"],
  send_imessage: ["text", "message", "send to", "tell"],
  send_location: ["location", "map", "directions", "address", "where is", "pin", "navigate", "restaurant", "place"],
  send_calendar_invite: ["calendar invite", "invite", "schedule", "event invite", "meeting invite"],
  send_voice_note: ["voice", "voice note", "say it", "speak", "read aloud", "audio"],
  send_image: ["show me", "picture", "image", "photo of", "what does", "look like"],
  browser: [
    "instagram", "ig", "insta", "canvas", "website", "log in", "sign in",
    "browse", "open", "post this", "my dms", "assignment", "homework", "grades",
    "doordash", "order", "book", "reservation",
    "uber", "lyft", "ride",
    "amazon", "shopping", "buy",
  ],
  start_tracking: [
    "track", "tracking", "package", "flight", "score", "game", "timer",
    "follow", "monitor", "watch", "delivery", "shipped", "ups", "fedex", "usps",
  ],
  generate_action_link: [
    "uber", "lyft", "ride", "venmo", "pay", "split", "facetime",
    "call", "directions", "navigate",
  ],
  create_document: [
    "cover letter", "resume", "document", "pdf", "meeting notes",
    "study guide", "expense report", "generate", "create a",
  ],
  manage_memory: [
    "forget", "remember", "what do you know", "my preferences",
    "clear memory", "delete memory",
  ],
  composio_action: [
    "spotify", "play", "song", "playlist", "music", "pause", "skip", "queue",
    "gmail", "email", "inbox", "send email", "mail", "check my",
    "calendar", "schedule", "event", "meeting",
    "slack", "slack message", "channel",
    "github", "pull request", "repo", "issue",
    "notion", "page", "database",
    "google drive", "file", "doc", "sheet",
    "twitter", "tweet", "post",
    "linkedin",
  ],
};

// Core tools always included
const CORE_TOOLS = ["web_search", "lookup_contact", "send_imessage", "composio_action"];

// Greetings and simple social messages that never need tools
const GREETING_PATTERN = /^(hi|hey|hello|sup|yo|what'?s? ?up|gm|good morning|good night|good evening|how are you|hola|wassup|wya|wyd|hiii+|heyy+|yo+|hihi|heyo|howdy|nm|nothing much|not much|chillin|vibing)[\s!?.]*$/i;

/**
 * Select relevant tools based on the user's message.
 * Returns empty array for greetings (no tools needed).
 * Always includes core tools for real queries, adds others based on keyword matching.
 */
export function selectRelevantTools(message: string): typeof ALL_TOOL_DEFINITIONS {
  // Greetings don't need any tools — skip entirely for speed
  if (GREETING_PATTERN.test(message.trim())) return [];

  const lower = message.toLowerCase();
  const selectedNames = new Set(CORE_TOOLS);

  for (const [toolName, keywords] of Object.entries(TOOL_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      selectedNames.add(toolName);
    }
  }

  // If nothing specific matched, include common ones
  if (selectedNames.size <= CORE_TOOLS.length) {
    selectedNames.add("iphone_action");
    selectedNames.add("browser");
  }

  return ALL_TOOL_DEFINITIONS.filter(t => selectedNames.has(t.function.name));
}

export const ALL_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web for current information — weather, news, prices, sports scores, facts, restaurants, places. Always use for weather queries. For restaurants/food/places, ALWAYS include 'open now' and the user's location in the query so results only show currently open places.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query. Include the user's location for weather/places. For restaurants/food/places, always add 'open now' to the query.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "iphone_action",
      description:
        "Perform a native action via iCloud. Use for: add calendar event, set reminder.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add_calendar_event", "set_reminder"],
            description: "The action to perform",
          },
          params: {
            type: "object",
            description:
              "set_reminder: {title, due_date?:'YYYY-MM-DD', due_time?:'HH:MM'}. " +
              "add_calendar_event: {title, date:'YYYY-MM-DD', start_time:'HH:MM', end_time:'HH:MM', notes?}.",
            additionalProperties: true,
          },
        },
        required: ["action", "params"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lookup_contact",
      description: "Look up a person by name in the user's iCloud contacts to get their phone number. Use before sending a message to someone by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The contact name to search for" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_imessage",
      description: "Send an iMessage to a phone number. Use lookup_contact first if you only have a name.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Phone number to send to (E.164 format e.g. +14155551234)" },
          message: { type: "string", description: "The message to send" },
        },
        required: ["to", "message"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_location",
      description: "Send a location pin with a map preview in iMessage. Use when sharing a place, restaurant, address, or giving directions. Coordinates are optional — the tool will geocode the name/address automatically if lat/lng are omitted.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Place name (e.g. 'Golden Gate Bridge')" },
          address: { type: "string", description: "Street address (optional if name is specific enough)" },
          lat: { type: "number", description: "Latitude (optional — auto-geocoded if omitted)" },
          lng: { type: "number", description: "Longitude (optional — auto-geocoded if omitted)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_calendar_invite",
      description: "Send a tappable calendar invite (.ics) via iMessage that the user can add to their calendar with one tap.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          date: { type: "string", description: "Event date YYYY-MM-DD" },
          start_time: { type: "string", description: "Start time HH:MM (24h)" },
          end_time: { type: "string", description: "End time HH:MM (24h)" },
          notes: { type: "string", description: "Optional event notes" },
        },
        required: ["title", "date", "start_time", "end_time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_voice_note",
      description: "Send a voice note audio message via iMessage. Use when the user asks you to speak, read aloud, or send a voice message.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to speak in the voice note" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_image",
      description: "Send an image from a URL via iMessage. Use after web_search finds an image to share, or when the user asks to see a picture of something.",
      parameters: {
        type: "object",
        properties: {
          image_url: { type: "string", description: "Direct URL to the image file" },
        },
        required: ["image_url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser",
      description:
        "Control a headless web browser to interact with any website (Instagram, Canvas, Gmail, Spotify, DoorDash, etc.). " +
        "Call with action 'start' first, then 'go_to' to navigate, 'extract_text' to read the page, " +
        "'get_elements' to list clickable/typeable items by number, 'click'/'type' to interact by element number, " +
        "'upload_file' to attach files, 'scroll' to scroll. Always 'stop' when done.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start", "go_to", "get_elements", "click", "type", "extract_text", "upload_file", "scroll", "stop"],
            description: "Browser action to perform",
          },
          url: { type: "string", description: "URL for go_to action" },
          element: { type: "number", description: "Element number from get_elements list (for click/type/upload_file)" },
          text: { type: "string", description: "Text to type (for type action)" },
          file_path: { type: "string", description: "Local file path (for upload_file action)" },
          direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        },
        required: ["action"],
      },
    },
  },
  // --- Innovation Layer Tools ---
  {
    type: "function" as const,
    function: {
      name: "start_tracking",
      description:
        "Start tracking something for periodic updates via iMessage. " +
        "Supports: package tracking (USPS/UPS/FedEx), live sports scores, flight status, and timers. " +
        "Updates are sent automatically when the status changes.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["package", "sports", "flight", "timer"],
            description: "What to track",
          },
          identifier: {
            type: "string",
            description: "Tracking number, flight number, team name, or timer duration in minutes",
          },
          label: {
            type: "string",
            description: "Optional label (e.g. 'Pasta timer', 'Lakers game')",
          },
        },
        required: ["type", "identifier"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_action_link",
      description:
        "Generate a tappable deep link that opens a native iOS app with pre-filled parameters. " +
        "Supported apps: uber, lyft, spotify, facetime, venmo, cashapp, apple_maps, google_maps, " +
        "doordash, instagram, twitter, whatsapp, shortcuts, timer. " +
        "The link renders as a tappable URL in iMessage.",
      parameters: {
        type: "object",
        properties: {
          app: {
            type: "string",
            description: "The app to open (e.g. 'uber', 'spotify', 'venmo', 'facetime', 'apple_maps')",
          },
          params: {
            type: "object",
            description:
              "App-specific parameters. Examples: " +
              "uber: {destination: 'LAX'}, " +
              "spotify: {search: 'chill vibes', playlist_id: '37i9dQ...'}, " +
              "venmo: {user: 'john', amount: '25.00', note: 'dinner'}, " +
              "facetime: {number: '+14155551234'}, " +
              "apple_maps: {destination: '1 Infinite Loop'}, " +
              "timer: {minutes: '15'}",
            additionalProperties: true,
          },
        },
        required: ["app", "params"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_document",
      description:
        "Generate a document (PDF) and send it via iMessage. " +
        "Use for: cover letters, meeting notes, study guides, expense reports, or any custom document. " +
        "Provide the key details and the document will be professionally formatted and sent as an attachment.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["cover_letter", "meeting_notes", "study_guide", "expense_report", "custom"],
            description: "Type of document to generate",
          },
          content: {
            type: "string",
            description: "The details to include in the document (job description for cover letter, discussion points for meeting notes, topics for study guide, expenses list for report, or freeform for custom)",
          },
          title: {
            type: "string",
            description: "Document title (optional — auto-generated if omitted)",
          },
        },
        required: ["type", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "manage_memory",
      description:
        "Manage the agent's memory about this user. Use when they ask what you know about them, " +
        "or when they want you to forget something.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "forget_all"],
            description: "list = show all memories, forget_all = wipe everything",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "composio_action",
      description:
        "Execute an action on a connected third-party service (Spotify, Gmail, Google Calendar, Slack, GitHub, Notion, Google Drive, Twitter, LinkedIn). " +
        "Use this INSTEAD of the browser tool for these services — it uses real APIs, not screen scraping. " +
        "If the user hasn't connected the service yet, this will return an OAuth link they can tap to connect.\n\n" +
        "Example actions:\n" +
        "- spotify: SPOTIFY_PLAY_TRACK, SPOTIFY_SEARCH, SPOTIFY_GET_CURRENT_PLAYING, SPOTIFY_PAUSE, SPOTIFY_SKIP\n" +
        "- gmail: GMAIL_SEND_EMAIL, GMAIL_LIST_EMAILS, GMAIL_READ_EMAIL\n" +
        "- google calendar: GOOGLECALENDAR_CREATE_EVENT, GOOGLECALENDAR_LIST_EVENTS\n" +
        "- slack: SLACK_SEND_MESSAGE, SLACK_LIST_CHANNELS\n" +
        "- github: GITHUB_CREATE_ISSUE, GITHUB_LIST_REPOS\n" +
        "- notion: NOTION_CREATE_PAGE, NOTION_SEARCH\n" +
        "If unsure of the exact action name, set action to 'search' and describe what you want in the params.description field.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description:
              "The Composio action name (e.g. SPOTIFY_PLAY_TRACK, GMAIL_SEND_EMAIL) or 'search' to discover actions",
          },
          params: {
            type: "object",
            description:
              "Action-specific parameters. For 'search' action, use {description: 'what you want to do'}. " +
              "For specific actions, pass the required input fields (e.g. {to: 'email', subject: 'Hi', body: 'Hello'})",
            additionalProperties: true,
          },
        },
        required: ["action"],
      },
    },
  },
];

/**
 * Execute a tool call. userPhone is the texting user's phone number,
 * used for iCloud credential lookup and browser session management.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userPhone: string,
): Promise<string> {
  switch (name) {
    case "web_search":
      return executeWebSearch(args.query as string, userPhone);
    case "iphone_action":
      return executeIphoneAction(
        args.action as string,
        args.params as Record<string, unknown>,
        userPhone,
      );
    case "lookup_contact": {
      const query = (args.name as string).toLowerCase();
      // Check synced contacts first
      const syncedContacts = await getSyncedContacts(userPhone);
      if (syncedContacts) {
        const matches = syncedContacts.filter((c: { name: string; phones?: string[]; emails?: string[] }) =>
          c.name.toLowerCase().includes(query)
        );
        if (matches.length > 0) {
          return matches.map((c: { name: string; phones?: string[] }) =>
            `${c.name}: ${c.phones?.join(", ") ?? "no phone"}`
          ).join("\n");
        }
      }
      // Check saved memories for learned contacts
      const agentId = process.env.IMESSAGE_AGENT_ID ?? "";
      const memories = await prisma.memory.findMany({
        where: { user_phone: userPhone, agent_id: agentId, key: { contains: query } },
        select: { key: true, value: true },
      });
      const phoneMemory = memories.find(m => m.value.match(/\+?\d[\d\s\-]{8,}/));
      if (phoneMemory) {
        const number = phoneMemory.value.match(/(\+?\d[\d\s\-]{8,})/)?.[1]?.replace(/[\s\-]/g, "");
        if (number) return `${phoneMemory.key}: ${number}`;
      }
      // Not found — send setup link to sync contacts
      return `NEEDS_SETUP:shortcut\nI need your contacts to find "${args.name}". Tap the link to connect.`;
    }
    case "send_imessage": {
      const to = args.to as string;
      if (!to || to === "+14152222222" || to.length < 10) {
        return "Cannot send — no verified phone number. Use lookup_contact first.";
      }
      try {
        await sendIMessage(to, args.message as string);
        console.log(`[iMessage] Sent on behalf of ${userPhone} → ${to}`);
        return `Message sent to ${to}.`;
      } catch (e) {
        return `Failed to send message: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "send_location": {
      try {
        let lat = args.lat as number | undefined;
        let lng = args.lng as number | undefined;
        let address = (args.address as string | undefined) ?? "";
        const name = args.name as string;

        if (lat == null || lng == null) {
          const location = getLocationString(userPhone) ?? process.env.DEFAULT_LOCATION ?? "Irvine, CA";
          const geoQuery = address ? `${name}, ${address}` : `${name}, ${location}`;
          let geo = await geocode(geoQuery);
          // Fallback: try just the address if name+address fails
          if (!geo && address) geo = await geocode(address);
          if (!geo) {
            return `Could not find coordinates for "${name}". Try providing a more specific address.`;
          }
          lat = geo.lat;
          lng = geo.lng;
          if (!address) address = geo.address;
        }

        await sendLocationPin(userPhone, name, address, lat, lng);
        return `Location pin sent for "${name}".`;
      } catch (e) {
        return `Failed to send location: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "send_calendar_invite": {
      try {
        await sendCalendarInvite(
          userPhone,
          args.title as string,
          args.date as string,
          args.start_time as string,
          args.end_time as string,
          args.notes as string | undefined,
        );
        return `Calendar invite sent for "${args.title}" on ${args.date}.`;
      } catch (e) {
        return `Failed to send calendar invite: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "send_voice_note": {
      try {
        await sendVoiceNote(userPhone, args.text as string);
        return `Voice note sent.`;
      } catch (e) {
        return `Failed to send voice note: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "send_image": {
      try {
        await sendImage(userPhone, args.image_url as string);
        return `Image sent.`;
      } catch (e) {
        return `Failed to send image: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "browser": {
      try {
        return await executeBrowser(
          args.action as string,
          (args as Record<string, unknown>) ?? {},
          userPhone,
        );
      } catch (e) {
        return `Browser error: ${e instanceof Error ? e.message : e}`;
      }
    }
    // --- Innovation Layer Tool Executors ---
    case "start_tracking": {
      const agentId = process.env.IMESSAGE_AGENT_ID ?? "";
      const trackType = args.type as string;
      const identifier = args.identifier as string;
      const label = args.label as string | undefined;

      try {
        switch (trackType) {
          case "package":
            return await trackPackage(userPhone, agentId, identifier);
          case "sports":
            return await trackSports(userPhone, agentId, identifier, label);
          case "flight":
            return await trackFlight(userPhone, agentId, identifier);
          case "timer": {
            const minutes = parseInt(identifier, 10);
            if (isNaN(minutes) || minutes <= 0) return "Invalid timer duration. Provide minutes as a number.";
            return await startTimer(userPhone, agentId, minutes, label);
          }
          default:
            return `Unknown tracking type: ${trackType}. Supported: package, sports, flight, timer.`;
        }
      } catch (e) {
        return `Tracking error: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "generate_action_link": {
      try {
        const app = args.app as string;
        const params = (args.params as Record<string, string>) ?? {};
        const link = generateDeepLink(app, params);
        if (!link) {
          return `App "${app}" is not supported. Supported apps: ${getSupportedApps().join(", ")}`;
        }
        return link;
      } catch (e) {
        return `Deep link error: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "create_document": {
      try {
        return await generateAndSendDocument({
          type: args.type as "cover_letter" | "meeting_notes" | "study_guide" | "expense_report" | "custom",
          content: args.content as string,
          title: args.title as string | undefined,
          userPhone,
        });
      } catch (e) {
        return `Document error: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "manage_memory": {
      const agentId = process.env.IMESSAGE_AGENT_ID ?? "";
      const action = args.action as string;
      try {
        if (action === "forget_all") {
          const count = await forgetAll(userPhone, agentId);
          return `Done — cleared ${count} memories. Fresh start!`;
        }
        if (action === "list") {
          const memories = await listMemories(userPhone, agentId);
          if (memories.length === 0) return "I don't have any memories stored about you yet.";
          const lines = memories.map((m) => `• [${m.type}] ${m.key}: ${m.value}`);
          return `Here's what I know about you:\n${lines.join("\n")}`;
        }
        return "Unknown memory action.";
      } catch (e) {
        return `Memory error: ${e instanceof Error ? e.message : e}`;
      }
    }
    case "composio_action": {
      try {
        const action = args.action as string;
        const params = (args.params as Record<string, unknown>) ?? {};
        const { getComposio } = await import("../composio.js");
        const composio = getComposio();

        // Create a session for this user (includes auth config overrides)
        const session = await createUserSession(userPhone);

        if (action === "search") {
          const description = (params.description as string) ?? "available actions";
          return `Search for "${description}" — use a specific action name like SPOTIFY_PLAY_TRACK, GMAIL_SEND_EMAIL, GOOGLECALENDAR_CREATE_EVENT, etc. and call composio_action again with that name.`;
        }

        // Try executing the action via the session
        try {
          const result = await session.execute(action, params);
          const resultStr = typeof result === "string" ? result : JSON.stringify(result);
          return resultStr;
        } catch (execErr) {
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);

          // Track the effective error (may change after retry)
          let effectiveErrMsg = errMsg;

          // If tool not found, auto-search for the right action name
          if (/not found|ToolNotFound/i.test(errMsg)) {
            try {
              const searchResult = await composio.tools.executeMetaTool(
                "COMPOSIO_SEARCH_TOOLS",
                {
                  sessionId: session.sessionId,
                  arguments: { query: action.replace(/_/g, " ").toLowerCase() },
                },
              );
              const results = (searchResult as any)?.data?.results;
              if (results?.length > 0) {
                const steps = results[0].recommended_plan_steps ?? [];
                // Find the [Required] step (not [Optional]) to get the main action
                const requiredStep = steps.find((s: string) => /\[Required\]/.test(s) && /\[Step\]/.test(s)) ?? steps[0] ?? "";
                // Extract tool name from the step (e.g. "GMAIL_FETCH_EMAILS")
                const toolMatch = requiredStep.match(/([A-Z][A-Z0-9_]+_[A-Z0-9_]+)/);
                if (toolMatch) {
                  // Retry with the correct action name
                  console.log(`[Composio] "${action}" not found, retrying with "${toolMatch[1]}"`);
                  try {
                    const retryResult = await session.execute(toolMatch[1], params);
                    const retryStr = typeof retryResult === "string" ? retryResult : JSON.stringify(retryResult);
                    return retryStr;
                  } catch (retryErr) {
                    // Update effective error so connection handling picks it up
                    effectiveErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                    console.log(`[Composio] Retry error: ${effectiveErrMsg.slice(0, 120)}`);
                    if (!/no active connection|NoActiveConnection/i.test(effectiveErrMsg)) {
                      return `Action failed: ${effectiveErrMsg}`;
                    }
                    console.log(`[Composio] Needs connection — falling through to MANAGE_CONNECTIONS`);
                    // Fall through to connection handling below
                  }
                } else {
                  return `"${action}" not found. Try one of these: ${results.slice(0, 3).map((r: any) => r.use_case).join(", ")}`;
                }
              }
            } catch (searchErr) {
              const searchMsg = searchErr instanceof Error ? searchErr.message : String(searchErr);
              if (/no active connection|NoActiveConnection/i.test(searchMsg)) {
                effectiveErrMsg = searchMsg;
              } else {
                return `Action "${action}" not found and search failed: ${searchMsg}`;
              }
            }
          }

          // If no active connection, use MANAGE_CONNECTIONS meta tool to get OAuth link
          console.log(`[Composio] Checking connection: effectiveErrMsg="${effectiveErrMsg.slice(0, 80)}", matches=${/no active connection|NoActiveConnection/i.test(effectiveErrMsg)}`);
          if (/no active connection|NoActiveConnection/i.test(effectiveErrMsg)) {
            const toolkit = inferToolkit(action);
            if (toolkit) {
              try {
                const connectResult = await composio.tools.executeMetaTool(
                  "COMPOSIO_MANAGE_CONNECTIONS",
                  {
                    sessionId: session.sessionId,
                    arguments: { toolkits: [toolkit] },
                  },
                );
                const data = (connectResult as any)?.data?.results?.[toolkit];
                if (data?.redirect_url) {
                  return `NEEDS_SETUP:oauth\nConnect your ${toolkit} account to use this: ${data.redirect_url}`;
                }
              } catch {
                // Fall through
              }
            }
            return `NEEDS_SETUP:oauth\nYou need to connect ${inferToolkit(action) ?? "this service"} first. I wasn't able to generate a link — try again in a moment.`;
          }
          throw execErr;
        }
      } catch (e) {
        return `Action failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Infer which Composio toolkit an action belongs to based on its name prefix.
 */
function inferToolkit(actionName: string): string | null {
  const upper = actionName.toUpperCase();
  if (upper.startsWith("SPOTIFY")) return "spotify";
  if (upper.startsWith("GMAIL")) return "gmail";
  if (upper.startsWith("GOOGLECALENDAR")) return "googlecalendar";
  if (upper.startsWith("SLACK")) return "slack";
  if (upper.startsWith("GITHUB")) return "github";
  if (upper.startsWith("NOTION")) return "notion";
  if (upper.startsWith("GOOGLE_DRIVE") || upper.startsWith("GOOGLEDRIVE")) return "google-drive";
  if (upper.startsWith("TWITTER")) return "twitter";
  if (upper.startsWith("LINKEDIN")) return "linkedin";
  return null;
}

// --- iCloud (app-specific password, stored in OAuthToken table) ---

async function getICloudCredentials(userPhone: string): Promise<string | null> {
  const token = await prisma.oAuthToken.findUnique({
    where: { user_phone_service: { user_phone: userPhone, service: "icloud" } },
  });
  return token?.access_token ?? null;
}

// --- iPhone actions (iCloud only) ---

async function executeIphoneAction(
  action: string,
  params: Record<string, unknown>,
  userPhone: string,
): Promise<string> {
  switch (action) {
    case "add_calendar_event": {
      const creds = await getICloudCredentials(userPhone);
      if (!creds) {
        return `NEEDS_SETUP:icloud\nTo add calendar events, I need your iCloud connected. Reply with: connect icloud youremail@icloud.com xxxx-xxxx-xxxx-xxxx (your app-specific password).`;
      }
      return addCalendarEvent(params, creds);
    }
    case "set_reminder": {
      const creds = await getICloudCredentials(userPhone);
      if (!creds) {
        return `NEEDS_SETUP:icloud\nTo set reminders, I need your iCloud connected. Reply with: connect icloud youremail@icloud.com xxxx-xxxx-xxxx-xxxx (your app-specific password).`;
      }
      return setReminder(params, creds);
    }
    default:
      return `That action isn't available yet. I can help with calendar events and reminders.`;
  }
}

// --- Web Search ---

const PLACE_KEYWORDS = /restaurant|cafe|coffee|bar|pub|store|shop|gym|hotel|motel|park|museum|theater|theatre|library|hospital|clinic|pharmacy|gas station|salon|barbershop|bakery|pizza|burger|sushi|ramen|taco|brunch|diner|grill|steakhouse|seafood|buffet|food|eat|open late|near me|nearby|closest|nearest|directions to|where is|find a|find me/i;

export function isPlaceQuery(query: string): boolean {
  return PLACE_KEYWORDS.test(query);
}

interface GoogleGeocodeResult {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
}

async function geocode(query: string): Promise<{ name: string; address: string; lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  // Try Places API first — finds actual businesses (McDonald's, Kit Coffee, etc.)
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=name,formatted_address,geometry&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    const data = (await res.json()) as { status: string; candidates: Array<{ name: string; formatted_address: string; geometry: { location: { lat: number; lng: number } } }> };
    if (data.status === "OK" && data.candidates?.length) {
      const c = data.candidates[0];
      return { name: c.name, address: c.formatted_address, lat: c.geometry.location.lat, lng: c.geometry.location.lng };
    }
  } catch { /* fall through to geocoding */ }
  // Fallback to Geocoding API — better for raw addresses
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    const data = (await res.json()) as { status: string; results: GoogleGeocodeResult[] };
    if (data.status !== "OK" || !data.results.length) return null;
    const r = data.results[0];
    return { name: r.formatted_address.split(", ")[0], address: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng };
  } catch {
    return null;
  }
}

interface SearchResult { title: string; url: string; content: string; score: number }

function extractPlaceName(results: SearchResult[]): string {
  // Try numbered list: "1. Noodle Nest · (312 reviews)"
  for (const r of results) {
    const listMatch = r.content.match(/1\.\s+([A-Za-z\s'&\-]+?)\s*·/);
    if (listMatch) return listMatch[1].trim();
  }
  // Try clean title (skip list page titles)
  for (const r of results) {
    const cleanTitle = r.title.split(/\s[-–|]\s/)[0].trim();
    if (cleanTitle.length < 50 && !/top|best|yelp|google|tripadvisor|updated|review|open now/i.test(cleanTitle)) {
      return cleanTitle.replace(/^\d+\.\s*/, "").trim();
    }
  }
  // Try quoted names in content
  for (const r of results) {
    const quoted = r.content.match(/"([A-Z][A-Za-z\s'&\-]{2,30})"/);
    if (quoted) return quoted[1].trim();
  }
  // Last resort — skip if it's a list page title
  const fallback = results[0].title.split(/\s[-–|]\s/)[0].replace(/^\d+\.\s*/, "").trim();
  if (/top|best|yelp|google|tripadvisor|updated|review|open now/i.test(fallback)) return "";
  return fallback;
}

async function executeWebSearch(query: string, userPhone?: string): Promise<string> {
  const location = (userPhone && getLocationString(userPhone)) ?? process.env.DEFAULT_LOCATION ?? "Irvine, CA";
  const isWeather = /weather|forecast|temperature|rain|sunny/i.test(query);
  const isPlace = !isWeather && isPlaceQuery(query);
  const finalQuery = isWeather || isPlace ? `${query} ${location}` : query;
  try {
    const { results } = await richSearch(finalQuery, {
      maxResults: 3,
      searchDepth: "basic",
    });
    if (!results.length) return "No search results found.";

    const searchText = results
      .map((r) => `${r.title}: ${r.content}`)
      .join("\n")
      .slice(0, 600);

    // Queue location pin for place queries — sent after the reply text
    if (isPlace && userPhone) {
      try {
        const placeName = extractPlaceName(results);
        console.log(`[iMessage] Place query detected, extracted: "${placeName}"`);
        if (placeName) {
          const geocodeQuery = `${placeName}, ${location}`;
          const geo = await geocode(geocodeQuery);
          if (geo) {
            _pendingPin.set(userPhone, { name: placeName || geo.name, address: geo.address, lat: geo.lat, lng: geo.lng });
            console.log(`[iMessage] Location pin queued: ${placeName} (${geo.lat}, ${geo.lng})`);
          }
        }
      } catch (e) {
        console.warn("[iMessage] Auto-geocode failed:", e);
      }
    }

    return searchText;
  } catch (e) {
    return `Search failed: ${e instanceof Error ? e.message : e}`;
  }
}
