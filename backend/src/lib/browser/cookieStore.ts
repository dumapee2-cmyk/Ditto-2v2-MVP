/**
 * Cookie Store — persists Playwright browser cookies per user per domain
 * using the existing OAuthToken table.
 */
import { prisma } from "../db.js";
import type { Cookie } from "playwright";

function serviceKey(domain: string): string {
  return `browser_cookies:${domain}`;
}

export async function saveCookiesForDomain(
  userPhone: string,
  domain: string,
  cookies: Cookie[],
): Promise<void> {
  const service = serviceKey(domain);
  await prisma.oAuthToken.upsert({
    where: { user_phone_service: { user_phone: userPhone, service } },
    update: { refresh_token: JSON.stringify(cookies) },
    create: {
      id: `${userPhone}_${service}`,
      user_phone: userPhone,
      service,
      access_token: "connected",
      refresh_token: JSON.stringify(cookies),
    },
  });
}

export async function loadCookiesForDomain(
  userPhone: string,
  domain: string,
): Promise<Cookie[] | null> {
  const token = await prisma.oAuthToken.findUnique({
    where: {
      user_phone_service: { user_phone: userPhone, service: serviceKey(domain) },
    },
  });
  if (!token?.refresh_token) return null;
  try {
    return JSON.parse(token.refresh_token) as Cookie[];
  } catch {
    return null;
  }
}
