/**
 * iCloud CardDAV — look up contacts by name using iCloud's CardDAV API.
 * Same auth as CalDAV: Apple ID + app-specific password stored in OAuthToken.
 * The access_token field stores "appleId:appSpecificPassword".
 */

const CARDDAV_BASE = "https://contacts.icloud.com";

async function carddavRequest(
  url: string,
  method: string,
  username: string,
  password: string,
  body?: string,
  depth?: number,
  contentType = "text/xml; charset=utf-8",
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
  if (depth !== undefined) headers["Depth"] = String(depth);

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });

  return { status: res.status, body: await res.text() };
}

/**
 * Discover the user's CardDAV principal URL.
 */
async function discoverPrincipal(username: string, password: string): Promise<string> {
  const res = await carddavRequest(
    `${CARDDAV_BASE}/`,
    "PROPFIND",
    username,
    password,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    0,
  );
  const match = res.body.match(/<d:href[^>]*>([^<]+)<\/d:href>/i) ||
                res.body.match(/<href[^>]*>([^<]+)<\/href>/i);
  if (!match) throw new Error("Could not discover CardDAV principal");
  return match[1].startsWith("http") ? match[1] : `${CARDDAV_BASE}${match[1]}`;
}

/**
 * Find the addressbook-home-set URL from the principal.
 */
async function discoverAddressbookHome(principalUrl: string, username: string, password: string): Promise<string> {
  const res = await carddavRequest(
    principalUrl,
    "PROPFIND",
    username,
    password,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
      <d:prop><card:addressbook-home-set/></d:prop>
    </d:propfind>`,
    0,
  );
  const match = res.body.match(/<card:addressbook-home-set[^>]*>\s*<d:href[^>]*>([^<]+)<\/d:href>/i) ||
                res.body.match(/addressbook-home-set[^>]*>[^<]*<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i);
  if (!match) throw new Error("Could not discover addressbook home");
  return match[1].startsWith("http") ? match[1] : `${CARDDAV_BASE}${match[1]}`;
}

/**
 * Search contacts by display name (FN field), return matching phone numbers.
 */
async function searchContacts(
  addressbookUrl: string,
  name: string,
  username: string,
  password: string,
): Promise<{ name: string; phones: string[] }[]> {
  const query = `<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">${name}</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

  const res = await carddavRequest(addressbookUrl, "REPORT", username, password, query, 1);

  // Parse vCards from multi-status response
  const vcards = res.body.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) ?? [];
  return vcards.map((vcard) => {
    const fnMatch = vcard.match(/^FN:(.+)$/m);
    const telMatches = [...vcard.matchAll(/^TEL[^:]*:(.+)$/gm)];
    const fn = fnMatch?.[1]?.trim() ?? name;
    const phones = telMatches
      .map((m) => m[1].trim().replace(/[^\d+]/g, ""))
      .filter((p) => p.length >= 7);
    return { name: fn, phones };
  }).filter((c) => c.phones.length > 0);
}

/**
 * Look up a contact by name and return their phone numbers.
 * credentials = "appleId:appSpecificPassword"
 */
export async function lookupContact(
  name: string,
  credentials: string,
): Promise<{ name: string; phones: string[] }[]> {
  const colonIdx = credentials.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid iCloud credentials format");
  const username = credentials.slice(0, colonIdx);
  const password = credentials.slice(colonIdx + 1);

  const principalUrl = await discoverPrincipal(username, password);
  const addressbookHome = await discoverAddressbookHome(principalUrl, username, password);
  return searchContacts(addressbookHome, name, username, password);
}
