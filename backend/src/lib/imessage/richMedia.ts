/**
 * Rich Media — sends location pins, calendar invites, voice notes,
 * and images via iMessage using vCards, .ics files, and attachments.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { getIMessageSDK } from "./imessageClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpFile(prefix: string, ext: string): string {
  return path.join(os.tmpdir(), `bit7-${prefix}-${Date.now()}${ext}`);
}

function cleanUp(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore — best-effort cleanup
  }
}

/**
 * Pad a number to two digits.
 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a Date as an iCalendar DATETIME string (no trailing Z — local time).
 * Example: 20260320T143000
 */
function formatICalDate(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/**
 * Generate a simple UID for iCalendar events.
 */
function generateUID(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rand}@bit7`;
}

// ---------------------------------------------------------------------------
// 1. Location Pin
// ---------------------------------------------------------------------------

/**
 * Send a location pin that renders as a native map preview in iMessage.
 *
 * Sends an Apple Maps URL directly via AppleScript (bypassing the SDK's
 * MessagePromise system). iMessage's URLBalloonProvider automatically
 * renders maps.apple.com URLs as native location balloons.
 *
 * @param to    Recipient phone number or email
 * @param name  Display name for the pin (e.g. "Golden Gate Bridge")
 * @param address  Human-readable street address
 * @param lat   Latitude
 * @param lng   Longitude
 */
export async function sendLocationPin(
  to: string,
  name: string,
  address: string,
  lat: number,
  lng: number,
): Promise<void> {
  const cleanName = name.replace(/\s+/g, "+");
  const mapsUrl = address
    ? `https://maps.apple.com/?ll=${lat},${lng}&q=${cleanName}&address=${encodeURIComponent(address)}`
    : `https://maps.apple.com/?ll=${lat},${lng}&q=${cleanName}`;

  // Send the Apple Maps URL directly via AppleScript, bypassing the SDK's
  // MessagePromise system which times out on URL strings.
  // iMessage automatically renders maps.apple.com URLs as native location
  // balloons (com.apple.messages.URLBalloonProvider) with the big map preview.
  const escapedUrl = mapsUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedTo = to.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const script = [
    'tell application "/System/Applications/Messages.app"',
    `  set targetBuddy to buddy "${escapedTo}"`,
    `  send "${escapedUrl}" to targetBuddy`,
    "end tell",
  ].join("\n");

  execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    stdio: "ignore",
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// 2. Calendar Invite
// ---------------------------------------------------------------------------

/**
 * Send a calendar invite (.ics) via iMessage.
 *
 * Generates a VCALENDAR/VEVENT with America/Los_Angeles timezone,
 * saves it to a temp file, and sends as an attachment.
 *
 * @param to         Recipient phone number or email
 * @param title      Event title / summary
 * @param date       Event date as a Date object or ISO string (date portion used)
 * @param startTime  Start time as "HH:MM" (24-hour, local to America/Los_Angeles)
 * @param endTime    End time as "HH:MM" (24-hour, local to America/Los_Angeles)
 * @param notes      Optional event description / notes
 */
export async function sendCalendarInvite(
  to: string,
  title: string,
  date: Date | string,
  startTime: string,
  endTime: string,
  notes?: string,
): Promise<void> {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  const dtStart = new Date(year, month, day, startH, startM, 0);
  const dtEnd = new Date(year, month, day, endH, endM, 0);

  const now = new Date();
  const uid = generateUID();

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bit7//RichMedia//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    // Timezone definition
    "BEGIN:VTIMEZONE",
    "TZID:America/Los_Angeles",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    // Event
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatICalDate(now)}`,
    `DTSTART;TZID=America/Los_Angeles:${formatICalDate(dtStart)}`,
    `DTEND;TZID=America/Los_Angeles:${formatICalDate(dtEnd)}`,
    `SUMMARY:${title}`,
    ...(notes ? [`DESCRIPTION:${notes.replace(/\n/g, "\\n")}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const ics = icsLines.join("\r\n") + "\r\n";
  const tmpPath = tmpFile("event", ".ics");
  fs.writeFileSync(tmpPath, ics, "utf-8");

  try {
    const sdk = getIMessageSDK();
    await sdk.sendFile(to, tmpPath, `${title}`);
  } finally {
    cleanUp(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// 3. Voice Note
// ---------------------------------------------------------------------------

/**
 * Generate a voice note from text using macOS `say` and send via iMessage.
 *
 * Uses the system TTS to produce an AIFF file, then converts to M4A
 * (AAC in an MPEG-4 container) so iMessage displays it as a playable
 * audio message.
 *
 * @param to    Recipient phone number or email
 * @param text  Text to speak
 */
export async function sendVoiceNote(
  to: string,
  text: string,
): Promise<void> {
  const aiffPath = tmpFile("voice", ".aiff");
  const m4aPath = tmpFile("voice", ".m4a");

  // Sanitize text to prevent shell injection — remove special chars
  const safeText = text.replace(/["`$\\]/g, "");

  try {
    // Generate speech as AIFF
    execSync(`say -o "${aiffPath}" "${safeText}"`, {
      stdio: "ignore",
      timeout: 30_000,
    });

    // Convert AIFF to M4A (AAC) using macOS built-in afconvert
    execSync(
      `afconvert -f m4af -d aac -b 128000 "${aiffPath}" "${m4aPath}"`,
      { stdio: "ignore", timeout: 30_000 },
    );

    const sdk = getIMessageSDK();
    await sdk.sendFile(to, m4aPath);
  } finally {
    cleanUp(aiffPath);
    cleanUp(m4aPath);
  }
}

// ---------------------------------------------------------------------------
// 4. Image from URL
// ---------------------------------------------------------------------------

/**
 * Download an image from a URL and send it via iMessage.
 *
 * Uses `curl` to fetch the image, detects the format from the
 * Content-Type header or URL extension, and sends as an attachment.
 *
 * @param to        Recipient phone number or email
 * @param imageUrl  URL of the image to download
 */
export async function sendImage(
  to: string,
  imageUrl: string,
): Promise<void> {
  // Determine file extension from URL (fallback to .jpg)
  const urlPath = new URL(imageUrl).pathname;
  const ext = path.extname(urlPath) || ".jpg";
  const tmpPath = tmpFile("image", ext);

  try {
    // Download the image using curl (available on all macOS)
    execSync(
      `curl -fsSL -o "${tmpPath}" --max-time 30 "${imageUrl}"`,
      { stdio: "ignore", timeout: 35_000 },
    );

    // Verify the file was actually written
    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
      throw new Error(`Failed to download image from ${imageUrl}`);
    }

    const sdk = getIMessageSDK();
    await sdk.sendFile(to, tmpPath);
  } finally {
    cleanUp(tmpPath);
  }
}
