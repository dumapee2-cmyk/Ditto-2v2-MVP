/**
 * iCloud CalDAV — create calendar events and reminders via standard CalDAV protocol.
 * No iOS app needed — uses the user's iCloud app-specific password.
 *
 * Each user's credentials are stored in OAuthToken with service="icloud".
 * The access_token field stores "appleId:appSpecificPassword".
 * Users generate an app-specific password at appleid.apple.com → Sign-In and Security.
 */

const CALDAV_BASE = "https://caldav.icloud.com";

async function caldavRequest(
  url: string,
  method: string,
  username: string,
  password: string,
  body?: string,
  depth?: number,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/xml; charset=utf-8",
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
  if (depth !== undefined) headers["Depth"] = String(depth);

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok && res.status !== 207) {
    throw new Error(`CalDAV error: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Discover the user's default calendar URL via CalDAV PROPFIND.
 */
async function discoverCalendarUrl(
  username: string,
  password: string,
): Promise<string> {
  // Step 1: Find current-user-principal
  const principalXml = await caldavRequest(
    `${CALDAV_BASE}/`,
    "PROPFIND",
    username,
    password,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    0,
  );

  const principalMatch = principalXml.match(/<d:href[^>]*>([^<]+)<\/d:href>/i);
  if (!principalMatch) throw new Error("Could not discover CalDAV principal");
  const principalPath = principalMatch[1];

  // Step 2: Find calendar-home-set
  const homeXml = await caldavRequest(
    `${CALDAV_BASE}${principalPath}`,
    "PROPFIND",
    username,
    password,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    0,
  );

  const homeMatch = homeXml.match(
    /<c(?:al)?:calendar-home-set[^>]*>\s*<d:href[^>]*>([^<]+)<\/d:href>/i,
  ) ?? homeXml.match(/<d:href[^>]*>([^<]*calendars[^<]*)<\/d:href>/i);

  if (!homeMatch) throw new Error("Could not discover calendar home");
  return homeMatch[1];
}

/**
 * Parse "appleId:appPassword" from the stored access_token.
 */
function parseICloudCreds(accessToken: string): { username: string; password: string } {
  const colonIdx = accessToken.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid iCloud credentials format");
  return {
    username: accessToken.slice(0, colonIdx),
    password: accessToken.slice(colonIdx + 1),
  };
}

/**
 * Add a calendar event via iCloud CalDAV.
 * @param accessToken - stored as "appleId:appSpecificPassword" from OAuthToken
 */
export async function addCalendarEvent(
  params: Record<string, unknown>,
  accessToken: string,
): Promise<string> {
  const { username, password } = parseICloudCreds(accessToken);

  const title = String(params.title ?? "Untitled Event");
  const date = String(params.date ?? new Date().toISOString().slice(0, 10));
  const startTime = String(params.start_time ?? "12:00");
  const endTime = String(params.end_time ?? "13:00");
  const notes = params.notes ? String(params.notes) : undefined;

  const uid = `bit7-${Date.now()}@bit7.ai`;
  const dtstart = `${date.replace(/-/g, "")}T${startTime.replace(":", "")}00`;
  const dtend = `${date.replace(/-/g, "")}T${endTime.replace(":", "")}00`;

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bit7//Bit7 Agent//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART;TZID=America/Los_Angeles:${dtstart}`,
    `DTEND;TZID=America/Los_Angeles:${dtend}`,
    notes ? `DESCRIPTION:${notes}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  try {
    const calendarHome = await discoverCalendarUrl(username, password);
    const eventUrl = `${CALDAV_BASE}${calendarHome}${uid}.ics`;

    await caldavRequest(eventUrl, "PUT", username, password, ical);

    return `Calendar event "${title}" added for ${date} at ${startTime}.`;
  } catch (e) {
    return `Failed to add calendar event: ${e instanceof Error ? e.message : e}`;
  }
}

/**
 * Set a reminder via iCloud CalDAV (VTODO).
 * @param accessToken - stored as "appleId:appSpecificPassword" from OAuthToken
 */
export async function setReminder(
  params: Record<string, unknown>,
  accessToken: string,
): Promise<string> {
  const { username, password } = parseICloudCreds(accessToken);

  const title = String(params.title ?? "Reminder");
  const date = params.date ? String(params.date) : undefined;
  const time = params.time ? String(params.time) : undefined;

  const uid = `bit7-todo-${Date.now()}@bit7.ai`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bit7//Bit7 Agent//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `SUMMARY:${title}`,
    "STATUS:NEEDS-ACTION",
  ];

  if (date) {
    const dt = date.replace(/-/g, "");
    if (time) {
      lines.push(`DUE;TZID=America/Los_Angeles:${dt}T${time.replace(":", "")}00`);
    } else {
      lines.push(`DUE;VALUE=DATE:${dt}`);
    }
  }

  lines.push("END:VTODO", "END:VCALENDAR");
  const ical = lines.join("\r\n");

  try {
    const calendarHome = await discoverCalendarUrl(username, password);
    const todoUrl = `${CALDAV_BASE}${calendarHome}${uid}.ics`;

    await caldavRequest(todoUrl, "PUT", username, password, ical);

    const dueStr = date ? ` due ${date}${time ? ` at ${time}` : ""}` : "";
    return `Reminder "${title}" set${dueStr}.`;
  } catch (e) {
    return `Failed to set reminder: ${e instanceof Error ? e.message : e}`;
  }
}
