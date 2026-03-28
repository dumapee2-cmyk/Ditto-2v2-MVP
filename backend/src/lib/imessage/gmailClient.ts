/**
 * Gmail API client — read, search, send emails via Google's REST API.
 */
import { prisma } from "../db.js";

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";

async function getValidToken(
  accessToken: string,
  refreshToken: string | null,
  userPhone: string,
): Promise<string | null> {
  const testRes = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (testRes.ok) return accessToken;
  if (!refreshToken) return null;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  });
  if (!refreshRes.ok) return null;

  const { access_token, expires_in } = (await refreshRes.json()) as {
    access_token: string;
    expires_in: number;
  };
  const expires_at = new Date(Date.now() + expires_in * 1000);

  await prisma.oAuthToken.update({
    where: { user_phone_service: { user_phone: userPhone, service: "gmail" } },
    data: { access_token, expires_at },
  });

  return access_token;
}

export async function executeGmail(
  action: string,
  params: Record<string, unknown>,
  accessToken: string,
  refreshToken: string | null,
  userPhone: string,
): Promise<string> {
  const token = await getValidToken(accessToken, refreshToken, userPhone) ?? accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    switch (action) {
      case "count_unread": {
        const res = await fetch(`${GMAIL_API}/messages?q=is:unread&maxResults=1`, { headers });
        const data = (await res.json()) as { resultSizeEstimate?: number };
        const count = data.resultSizeEstimate ?? 0;
        return count === 0 ? "No unread emails." : `You have approximately ${count} unread email${count === 1 ? "" : "s"}.`;
      }

      case "search": {
        const query = params.query as string;
        const res = await fetch(`${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=5`, { headers });
        const data = (await res.json()) as { messages?: { id: string }[] };
        if (!data.messages?.length) return `No emails found for "${query}".`;

        const summaries: string[] = [];
        for (const msg of data.messages.slice(0, 3)) {
          const detail = await fetch(`${GMAIL_API}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers });
          const d = (await detail.json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
          const from = d.payload?.headers?.find(h => h.name === "From")?.value ?? "Unknown";
          const subject = d.payload?.headers?.find(h => h.name === "Subject")?.value ?? "(no subject)";
          summaries.push(`From: ${from}\nSubject: ${subject}\n${d.snippet ?? ""}`);
        }
        return summaries.join("\n---\n").slice(0, 800);
      }

      case "read_latest": {
        const res = await fetch(`${GMAIL_API}/messages?maxResults=3`, { headers });
        const data = (await res.json()) as { messages?: { id: string }[] };
        if (!data.messages?.length) return "No emails found.";

        const summaries: string[] = [];
        for (const msg of data.messages.slice(0, 3)) {
          const detail = await fetch(`${GMAIL_API}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers });
          const d = (await detail.json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
          const from = d.payload?.headers?.find(h => h.name === "From")?.value ?? "Unknown";
          const subject = d.payload?.headers?.find(h => h.name === "Subject")?.value ?? "(no subject)";
          summaries.push(`From: ${from}\nSubject: ${subject}\n${d.snippet ?? ""}`);
        }
        return summaries.join("\n---\n").slice(0, 800);
      }

      case "send": {
        const to = params.to as string;
        const subject = params.subject as string;
        const body = params.body as string;
        const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`)
          .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const res = await fetch(`${GMAIL_API}/messages/send`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        if (!res.ok) return `Failed to send email: ${await res.text()}`;
        return `Email sent to ${to}.`;
      }

      default:
        return `Unknown Gmail action: ${action}`;
    }
  } catch (e) {
    return `Gmail error: ${e instanceof Error ? e.message : e}`;
  }
}
