/**
 * Webhook Route — handles incoming SMS from Twilio.
 *
 * POST /api/webhook/twilio
 * Twilio sends form-urlencoded data for each incoming message.
 */
import { Router } from "express";
import { parseWebhook, validateTwilioSignature, sendSMS } from "../lib/twilio/twilioClient.js";
import { handleIncomingMessage } from "../lib/agentRuntime.js";

export const webhookRouter = Router();

/**
 * Twilio sends application/x-www-form-urlencoded by default.
 * Express needs urlencoded middleware for this route.
 */
webhookRouter.post("/twilio", async (req, res) => {
  try {
    // Validate Twilio signature in production
    if (process.env.NODE_ENV === "production") {
      const signature = req.headers["x-twilio-signature"] as string;
      const url = `${process.env.TWILIO_WEBHOOK_BASE_URL}/api/webhook/twilio`;
      if (!signature || !validateTwilioSignature(signature, url, req.body)) {
        console.warn("[Webhook] Invalid Twilio signature");
        return res.status(403).send("Forbidden");
      }
    }

    const payload = parseWebhook(req.body);

    console.log(`[Webhook] Incoming SMS from ${payload.From} to ${payload.To}: "${payload.Body.slice(0, 50)}"`);

    // Handle the message
    const result = await handleIncomingMessage(
      payload.To,
      payload.From,
      payload.Body,
      payload.MediaUrl0,
      payload.MediaContentType0,
    );

    // Send reply via Twilio API (async, not TwiML)
    await sendSMS(payload.From, payload.To, result.reply);

    console.log(`[Webhook] Reply sent to ${payload.From}: "${result.reply.slice(0, 50)}"`);

    // Return empty TwiML to acknowledge receipt
    res.type("text/xml").send("<Response></Response>");
  } catch (e) {
    console.error("[Webhook] Error handling incoming SMS:", e);
    // Still return 200 to Twilio so it doesn't retry
    res.type("text/xml").send("<Response></Response>");
  }
});
