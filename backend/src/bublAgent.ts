import { IMessageSDK } from "@photon-ai/imessage-kit";

const sdk = new IMessageSDK();

const TYPING_URL = process.env.TYPING_URL ?? "http://localhost:5055";

const WELCOME_REPLIES = [
  "get excited! your date is curating 💭",
  "ooh someone's ready 👀 your match is brewing",
  "locked in 🔒 we're finding your perfect match",
];

function pickReply(): string {
  return WELCOME_REPLIES[Math.floor(Math.random() * WELCOME_REPLIES.length)];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendReadReceipt(phone: string) {
  try {
    await fetch(`${TYPING_URL}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: phone }),
    });
  } catch {}
}

async function startTyping(phone: string) {
  try {
    await fetch(`${TYPING_URL}/typing/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: phone }),
    });
  } catch {}
}

async function stopTyping(phone: string) {
  try {
    await fetch(`${TYPING_URL}/typing/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: phone }),
    });
  } catch {}
}

export async function startBublAgent() {
  await sdk.startWatching({
    onDirectMessage: async (msg) => {
      if (msg.isFromMe) return;

      const sender = msg.sender;
      console.log(`[Bubl] From ${sender}: "${msg.text}"`);

      // Read receipt
      await sendReadReceipt(sender);
      await sleep(300);

      // Typing indicator
      await startTyping(sender);

      // Simulate typing for 1 second
      const typingMs = 1000;
      await sleep(typingMs);

      // Send reply
      const reply = pickReply();
      await sdk.send(sender, reply);
      console.log(`[Bubl] Replied to ${sender}: "${reply}"`);

      // Stop typing
      await stopTyping(sender);
    },
  });

  console.log("[Bubl] Agent active — listening for iMessages");
}
