/**
 * Deep Links — URL scheme registry for native iOS app actions.
 *
 * Generates tappable links that iMessage renders inline.
 * When tapped, they open the corresponding native app with pre-filled parameters.
 *
 * This turns every suggestion into a one-tap action.
 */

// ---------------------------------------------------------------------------
// URL scheme registry
// ---------------------------------------------------------------------------

type LinkGenerator = (params: Record<string, string>) => string;

const LINK_GENERATORS: Record<string, LinkGenerator> = {
  uber: (p) => {
    const parts = ["uber://"];
    if (p.destination) {
      parts[0] = `uber://?action=setPickup&pickup=my_location&dropoff[formatted_address]=${enc(p.destination)}`;
    }
    return parts[0];
  },

  lyft: (p) => {
    if (p.destination) {
      return `lyft://ridetype?id=lyft&destination[address]=${enc(p.destination)}`;
    }
    return "lyft://";
  },

  spotify: (p) => {
    if (p.playlist_id) return `spotify:playlist:${p.playlist_id}`;
    if (p.track_id) return `spotify:track:${p.track_id}`;
    if (p.artist_id) return `spotify:artist:${p.artist_id}`;
    if (p.search) return `spotify:search:${enc(p.search)}`;
    return "spotify://";
  },

  apple_music: (p) => {
    if (p.search) return `music://music.apple.com/search?term=${enc(p.search)}`;
    return "music://";
  },

  facetime: (p) => {
    if (p.number) return `facetime://${p.number}`;
    if (p.email) return `facetime://${p.email}`;
    return "facetime://";
  },

  facetime_audio: (p) => {
    if (p.number) return `facetime-audio://${p.number}`;
    return "facetime-audio://";
  },

  phone: (p) => {
    if (p.number) return `tel:${p.number}`;
    return "tel://";
  },

  venmo: (p) => {
    const parts = ["venmo://"];
    if (p.user && p.amount) {
      parts[0] = `venmo://paycharge?txn=pay&recipients=${enc(p.user)}&amount=${p.amount}`;
      if (p.note) parts[0] += `&note=${enc(p.note)}`;
    }
    return parts[0];
  },

  cashapp: (p) => {
    if (p.user) return `cashapp://cash.app/$${p.user}`;
    return "cashapp://";
  },

  apple_maps: (p) => {
    if (p.destination) {
      return `maps://?daddr=${enc(p.destination)}&dirflg=d`;
    }
    if (p.search) return `maps://?q=${enc(p.search)}`;
    if (p.lat && p.lng) return `maps://?ll=${p.lat},${p.lng}`;
    return "maps://";
  },

  google_maps: (p) => {
    if (p.destination) {
      return `comgooglemaps://?daddr=${enc(p.destination)}&directionsmode=driving`;
    }
    if (p.search) return `comgooglemaps://?q=${enc(p.search)}`;
    return "comgooglemaps://";
  },

  shortcuts: (p) => {
    if (p.name) {
      let url = `shortcuts://run-shortcut?name=${enc(p.name)}`;
      if (p.input) url += `&input=${enc(p.input)}`;
      return url;
    }
    return "shortcuts://";
  },

  doordash: (p) => {
    if (p.search) return `doordash://search/?query=${enc(p.search)}`;
    return "doordash://";
  },

  instagram: (p) => {
    if (p.username) return `instagram://user?username=${p.username}`;
    return "instagram://";
  },

  twitter: (p) => {
    if (p.username) return `twitter://user?screen_name=${p.username}`;
    if (p.tweet) return `twitter://post?message=${enc(p.tweet)}`;
    return "twitter://";
  },

  whatsapp: (p) => {
    if (p.number) return `whatsapp://send?phone=${p.number}`;
    return "whatsapp://";
  },

  calendar: (p) => {
    // Opens Calendar app — no deep link params available, but launching is useful
    return "calshow://";
  },

  reminders: (_p) => {
    return "x-apple-reminderkit://";
  },

  settings: (p) => {
    // Open specific settings pages
    const pages: Record<string, string> = {
      wifi: "App-prefs:WIFI",
      bluetooth: "App-prefs:Bluetooth",
      battery: "App-prefs:BATTERY_USAGE",
      notifications: "App-prefs:NOTIFICATIONS_ID",
      general: "App-prefs:General",
      display: "App-prefs:DISPLAY",
      sounds: "App-prefs:Sounds",
      privacy: "App-prefs:Privacy",
    };
    return pages[p.page ?? ""] ?? "App-prefs:";
  },

  timer: (p) => {
    // Opens Clock app timer
    if (p.minutes) {
      const seconds = parseInt(p.minutes, 10) * 60;
      return `clock-timer://timer?duration=${seconds}`;
    }
    return "clock-timer://";
  },
};

function enc(s: string): string {
  return encodeURIComponent(s);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type DeepLinkApp = keyof typeof LINK_GENERATORS;

/**
 * Generate a deep link URL for a native app action.
 * Returns null if the app is not supported.
 */
export function generateDeepLink(
  app: string,
  params: Record<string, string>,
): string | null {
  const generator = LINK_GENERATORS[app.toLowerCase()];
  if (!generator) return null;

  try {
    return generator(params);
  } catch (e) {
    console.warn(`[DeepLinks] Failed to generate link for ${app}:`, e);
    return null;
  }
}

/**
 * Get all supported app names for deep links.
 */
export function getSupportedApps(): string[] {
  return Object.keys(LINK_GENERATORS);
}

/**
 * Generate a formatted deep link message — the link text + the tappable URL.
 * iMessage will make the URL tappable automatically.
 */
export function formatDeepLinkMessage(
  app: string,
  params: Record<string, string>,
  label?: string,
): string | null {
  const url = generateDeepLink(app, params);
  if (!url) return null;

  // Return just the URL — iMessage makes it tappable.
  // If a label is provided, put it on its own line above the link.
  if (label) {
    return `${label}\n${url}`;
  }
  return url;
}

/**
 * Generate a Venmo request link for bill splitting.
 * Useful for group chat bill splitting.
 */
export function generateVenmoSplitLinks(
  totalAmount: number,
  splitCount: number,
  venmoUsernames: string[],
  note: string = "Split",
): string[] {
  const perPerson = (totalAmount / splitCount).toFixed(2);
  return venmoUsernames.map((user) =>
    generateDeepLink("venmo", {
      user,
      amount: perPerson,
      note: `${note} ($${perPerson} each)`,
    }),
  ).filter(Boolean) as string[];
}
