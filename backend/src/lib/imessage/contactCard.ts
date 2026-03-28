/**
 * Contact Card — generates and sends a vCard (.vcf) for the Bit7 agent
 * so users can easily save the contact with name + profile picture.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getIMessageSDK } from "./imessageClient.js";

const ASSETS_DIR = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../../assets",
);

/**
 * Build a vCard string, optionally embedding a profile photo.
 */
function buildVCard(name: string, org: string, note: string): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${name}`,
    `N:;${name};;;`,
    `ORG:${org}`,
    "TITLE:AI Companion",
    `NOTE:${note}`,
    "EMAIL;type=INTERNET;type=pref:bitseven@icloud.com",
    "IMPP;X-SERVICE-TYPE=iMessage;type=pref:imessage:bitseven@icloud.com",
  ];

  // Embed profile photo if it exists
  const avatarPath = path.join(ASSETS_DIR, "bit7-avatar.jpg");
  if (fs.existsSync(avatarPath)) {
    const imageData = fs.readFileSync(avatarPath).toString("base64");
    lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${imageData}`);
  }

  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/**
 * Send the Bit7 contact card to a user via iMessage.
 * Creates a temp .vcf file and sends it as an attachment.
 */
export async function sendContactCard(to: string): Promise<void> {
  const vcf = buildVCard(
    "Bit7",
    "Bit7",
    "Your iMessage AI companion — powered by Bit7",
  );

  const tmpPath = path.join(os.tmpdir(), `bit7-contact-${Date.now()}.vcf`);
  fs.writeFileSync(tmpPath, vcf, "utf-8");

  try {
    const sdk = getIMessageSDK();
    await sdk.sendFile(to, tmpPath, "Here's my contact card — save it to add me to your contacts!");
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}
