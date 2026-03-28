/**
 * Twilio Client — wraps the Twilio SDK for sending SMS/MMS
 * and parsing incoming webhook payloads.
 */
import Twilio from "twilio";
import type { TwilioWebhookPayload } from "../../types/index.js";

let _client: ReturnType<typeof Twilio> | null = null;

function getClient(): ReturnType<typeof Twilio> {
  if (!_client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
    }
    _client = Twilio(sid, token);
  }
  return _client;
}

export async function sendSMS(
  to: string,
  from: string,
  body: string,
): Promise<string> {
  const client = getClient();
  const message = await client.messages.create({ to, from, body });
  return message.sid;
}

export async function sendMMS(
  to: string,
  from: string,
  body: string,
  mediaUrl: string,
): Promise<string> {
  const client = getClient();
  const message = await client.messages.create({
    to,
    from,
    body,
    mediaUrl: [mediaUrl],
  });
  return message.sid;
}

/**
 * Parse a Twilio webhook request body into a typed payload.
 */
export function parseWebhook(body: Record<string, string>): TwilioWebhookPayload {
  return {
    MessageSid: body.MessageSid ?? "",
    From: body.From ?? "",
    To: body.To ?? "",
    Body: body.Body ?? "",
    NumMedia: body.NumMedia ?? "0",
    MediaUrl0: body.MediaUrl0,
    MediaContentType0: body.MediaContentType0,
  };
}

/**
 * Validate that a request came from Twilio using the X-Twilio-Signature header.
 */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  return Twilio.validateRequest(token, signature, url, params);
}

export { getClient };
