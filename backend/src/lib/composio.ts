/**
 * Composio client — unified OAuth + tool execution for all third-party services.
 *
 * Most toolkits (Gmail, Calendar, Slack, GitHub, Notion, Drive, LinkedIn) use
 * Composio-managed OAuth apps — zero config needed.
 *
 * Toolkits that require your own OAuth app (Spotify, Twitter) need an auth config
 * ID set via env vars (created once via Composio dashboard or SDK).
 *
 * Each user is identified by their phone number.
 * Sessions are cached per user so multi-step tasks reuse the same session.
 */
import { Composio } from "@composio/core";

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY ?? "";

let _composio: Composio | null = null;

export function getComposio(): Composio {
  if (!_composio) {
    if (!COMPOSIO_API_KEY) {
      throw new Error("COMPOSIO_API_KEY not set — add it to your .env");
    }
    _composio = new Composio({ apiKey: COMPOSIO_API_KEY });
  }
  return _composio;
}

/**
 * Auth config overrides for toolkits that need custom OAuth apps.
 * Map of toolkit slug → auth config ID (from Composio dashboard).
 * Only needed for services where Composio doesn't manage auth.
 */
function getAuthConfigs(): Record<string, string> {
  const configs: Record<string, string> = {};
  if (process.env.COMPOSIO_SPOTIFY_AC) configs.spotify = process.env.COMPOSIO_SPOTIFY_AC;
  if (process.env.COMPOSIO_TWITTER_AC) configs.twitter = process.env.COMPOSIO_TWITTER_AC;
  return configs;
}

/**
 * Session cache — avoids creating a new session for every tool call
 * in a multi-step agentic task. Sessions expire after 10 minutes.
 */
const SESSION_TTL_MS = 10 * 60 * 1000;
const sessionCache = new Map<string, { session: any; createdAt: number }>();

/**
 * Get or create a Composio session for a user. Cached so that
 * chained tool calls within the same conversation reuse the session.
 */
export async function createUserSession(userPhone: string) {
  const cached = sessionCache.get(userPhone);
  if (cached && Date.now() - cached.createdAt < SESSION_TTL_MS) {
    return cached.session;
  }

  const composio = getComposio();
  const authConfigs = getAuthConfigs();
  const opts = Object.keys(authConfigs).length > 0 ? { authConfigs } : undefined;
  const session = await composio.create(userPhone, opts);

  sessionCache.set(userPhone, { session, createdAt: Date.now() });
  return session;
}
