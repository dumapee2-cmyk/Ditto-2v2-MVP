/**
 * Nango client — centralized OAuth token management for all services.
 * Handles token storage, refresh, and connect session creation.
 *
 * Services: spotify, google-mail, uber, google-home
 * Each user is identified by their phone number as the connectionId.
 */
import { Nango } from "@nangohq/node";

const NANGO_SECRET_KEY = process.env.NANGO_SECRET_KEY ?? "";

let _nango: Nango | null = null;

export function getNango(): Nango {
  if (!_nango) {
    _nango = new Nango({ secretKey: NANGO_SECRET_KEY });
  }
  return _nango;
}

/**
 * Get a valid access token for a service+user, or null if not connected.
 * Nango handles token refresh automatically.
 */
export async function getServiceToken(
  service: string,
  userPhone: string,
): Promise<string | null> {
  try {
    const token = await getNango().getToken(service, userPhone);
    if (typeof token === "string") return token;
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a connect session and return the connect URL for a user.
 * The user taps this link → Nango handles the entire OAuth flow.
 */
export async function getConnectUrl(
  service: string,
  userPhone: string,
): Promise<string> {
  const session = await getNango().createConnectSession({
    end_user: { id: userPhone },
    allowed_integrations: [service],
  });
  return session.data.connect_link;
}

/**
 * Check if a user has connected a service.
 */
export async function isServiceConnected(
  service: string,
  userPhone: string,
): Promise<boolean> {
  const token = await getServiceToken(service, userPhone);
  return token !== null;
}
