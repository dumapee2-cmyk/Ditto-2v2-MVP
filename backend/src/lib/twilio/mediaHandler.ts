/**
 * Media Handler — downloads MMS attachments from Twilio
 * and converts them to base64 for the Vision API.
 */

const TWILIO_ACCOUNT_SID = () => process.env.TWILIO_ACCOUNT_SID ?? "";
const TWILIO_AUTH_TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? "";

/**
 * Download media from a Twilio media URL.
 * Twilio requires basic auth to access media.
 */
export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID()}:${TWILIO_AUTH_TOKEN()}`).toString("base64");

  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download and convert media to a base64 data URL for the Vision API.
 */
export async function getBase64Image(
  mediaUrl: string,
  contentType: string = "image/jpeg",
): Promise<string> {
  const buffer = await downloadMedia(mediaUrl);
  const base64 = buffer.toString("base64");
  return `data:${contentType};base64,${base64}`;
}
