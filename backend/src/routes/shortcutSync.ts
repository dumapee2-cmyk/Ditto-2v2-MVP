/**
 * Shortcut Sync Routes — receives contacts, location, and calendar data
 * from the iOS Shortcut. No authentication required (data comes directly
 * from the user's device).
 *
 * POST /api/sync/data — receives all data in one request
 */
import { Router } from "express";
import { prisma } from "../lib/db.js";

const router = Router();

interface SyncContact {
  name: string;
  phones?: string[];
  emails?: string[];
}

interface SyncPayload {
  phone: string; // user's phone number (from iMessage)
  contacts?: SyncContact[];
  location?: { lat: number; lng: number };
  calendar?: Array<{ title: string; date: string; start?: string; end?: string; location?: string }>;
}

router.post("/data", async (req, res) => {
  let phone = (req.query.phone as string) || "";

  // If no phone provided, find the most recent user who texted us
  if (!phone) {
    try {
      const recentState = await prisma.userState.findFirst({
        where: { agent_id: process.env.IMESSAGE_AGENT_ID ?? "" },
        orderBy: { last_active: "desc" },
        select: { user_phone: true },
      });
      if (recentState) {
        phone = recentState.user_phone;
        console.log(`[Sync] Auto-detected user from last active: ${phone}`);
      }
    } catch { /* ignore */ }
  }

  // Shortcuts sends malformed JSON — the contacts value merges with keys
  // Parse the raw body string to extract contact names
  let contacts: SyncContact[] | undefined;
  let location: { lat: number; lng: number } | undefined;
  let calendar: Array<{ title: string; date: string }> | undefined;

  const rawBody = JSON.stringify(req.body);
  console.log(`[Sync] Raw body type: ${typeof req.body}, keys: ${Object.keys(req.body || {})}`);

  // Try to extract names from the malformed body
  // The body looks like: {"contactsMom\nEmre\nQassim\n..."}
  // Or it could be proper JSON
  if (req.body?.contacts && typeof req.body.contacts === "string") {
    contacts = req.body.contacts.trim().split("\n").filter(Boolean).map((n: string) => ({ name: n.trim() }));
  } else if (Array.isArray(req.body?.contacts)) {
    contacts = req.body.contacts;
  } else {
    // Malformed — try to extract names from all string values in body
    const allText = Object.keys(req.body || {}).join("\n") + "\n" + Object.values(req.body || {}).join("\n");
    const names = allText.split("\n").map((s: string) => s.trim()).filter((s: string) => s && s.length > 1 && s.length < 50 && !s.startsWith("{") && !s.startsWith("http"));
    if (names.length > 0) {
      contacts = names.map((n: string) => ({ name: n }));
    }
  }

  if (req.body?.location) {
    location = req.body.location;
  }

  if (!phone) {
    return res.status(400).json({ status: "error", message: "Missing phone number. Add ?phone=+1XXXXXXXXXX to the URL." });
  }

  console.log(`[Sync] Raw body keys: ${Object.keys(req.body || {})}`);
  console.log(`[Sync] Raw body sample: ${JSON.stringify(req.body).slice(0, 500)}`);
  console.log(`[Sync] Receiving data for ${phone}: ${contacts?.length ?? 0} contacts, location=${!!location}, ${calendar?.length ?? 0} events`);

  try {
    // Find the user's agent state
    const agentId = process.env.IMESSAGE_AGENT_ID;
    if (!agentId) {
      return res.status(500).json({ status: "error", message: "No agent configured" });
    }

    // Get or create user state
    const userState = await prisma.userState.upsert({
      where: { agent_id_user_phone: { agent_id: agentId, user_phone: phone } },
      create: { agent_id: agentId, user_phone: phone, data: {} },
      update: {},
    });

    const data = (userState.data as Record<string, unknown>) ?? {};

    // Store location
    if (location?.lat && location?.lng) {
      data.location = { lat: location.lat, lng: location.lng, updated_at: new Date().toISOString() };
      console.log(`[Sync] Location stored for ${phone}: ${location.lat}, ${location.lng}`);
    }

    // Store contacts
    if (contacts && contacts.length > 0) {
      data.contacts = contacts;
      data.contacts_updated_at = new Date().toISOString();
      console.log(`[Sync] ${contacts.length} contacts stored for ${phone}`);
    }

    // Store calendar events
    if (calendar && calendar.length > 0) {
      data.calendar_events = calendar;
      data.calendar_updated_at = new Date().toISOString();
      console.log(`[Sync] ${calendar.length} calendar events stored for ${phone}`);
    }

    // Save
    await prisma.userState.update({
      where: { agent_id_user_phone: { agent_id: agentId, user_phone: phone } },
      data: { data: data as any },
    });

    return res.json({
      status: "success",
      synced: {
        contacts: contacts?.length ?? 0,
        location: !!location,
        calendar: calendar?.length ?? 0,
      },
    });
  } catch (e) {
    console.error("[Sync] Error:", e);
    return res.status(500).json({ status: "error", message: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/sync/shortcut-config
 * Returns the configuration for the iOS Shortcut to know where to send data.
 */
router.get("/shortcut-config", (req, res) => {
  const serverUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    syncUrl: `${serverUrl}/api/sync/data`,
    authUrl: `${serverUrl}/api/icloud/auth-page`,
  });
});

// Debug endpoint that captures raw body
router.post("/raw", (req, res) => {
  let rawBody = "";
  req.on("data", (chunk: Buffer) => rawBody += chunk.toString());
  req.on("end", () => {
    console.log("[Sync/Raw] Content-Type:", req.headers["content-type"]);
    console.log("[Sync/Raw] Body length:", rawBody.length);
    console.log("[Sync/Raw] First 1000 chars:", rawBody.slice(0, 1000));
    res.json({ status: "success", received: rawBody.length });
  });
});

export default router;
