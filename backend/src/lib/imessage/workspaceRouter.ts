/**
 * Workspace Router — multi-persona prefix-based routing.
 *
 * Users can switch between different agent personalities by prefixing messages:
 * - (no prefix) → Casual friend / general assistant
 * - "work:" → Professional assistant (email, meetings, Slack)
 * - "study:" → Academic tutor (Canvas, homework, study scheduling)
 * - "fit:" → Fitness coach (workouts, nutrition, health data)
 *
 * Workspaces are "sticky" — once activated, subsequent messages stay in
 * the same workspace until the user switches or says "exit".
 */

// ---------------------------------------------------------------------------
// Workspace definitions
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  id: string;
  name: string;
  prefix: string;
  systemPromptExtension: string;
  /** Tools to always include in this workspace */
  priorityTools: string[];
  /** Tools to exclude in this workspace */
  excludeTools: string[];
  /** Memory partition — memories tagged with this namespace */
  memoryNamespace: string;
}

const WORKSPACES: Record<string, WorkspaceConfig> = {
  default: {
    id: "default",
    name: "General",
    prefix: "",
    systemPromptExtension: "",
    priorityTools: [],
    excludeTools: [],
    memoryNamespace: "general",
  },

  work: {
    id: "work",
    name: "Professional",
    prefix: "work:",
    systemPromptExtension: `
You are now in WORK mode — a professional productivity assistant.
- Tone: concise, professional, direct. No emojis unless the user uses them.
- Focus areas: email drafting, meeting prep, calendar management, task prioritization.
- When drafting emails: use proper business formatting, match the user's writing style.
- When prepping for meetings: summarize agenda, suggest talking points, note action items.
- Proactively suggest time-blocking and prioritization.
- Use the browser tool for: Gmail, Slack, Google Calendar, Notion, LinkedIn.`,
    priorityTools: ["browser", "iphone_action", "send_calendar_invite", "web_search"],
    excludeTools: ["send_voice_note"],
    memoryNamespace: "work",
  },

  study: {
    id: "study",
    name: "Academic",
    prefix: "study:",
    systemPromptExtension: `
You are now in STUDY mode — an academic tutor and study companion.
- Tone: patient, encouraging, Socratic. Guide them to answers rather than giving them directly.
- Focus areas: homework help, exam prep, study scheduling, Canvas integration.
- For math/science: show step-by-step work, explain the "why" behind each step.
- For writing: help brainstorm, outline, and review — don't write the essay for them.
- Proactively suggest study techniques (Pomodoro, spaced repetition, active recall).
- Use the browser tool for: Canvas, Google Scholar, Khan Academy, Quizlet.
- When they share a screenshot of an assignment, extract the questions and help with each.`,
    priorityTools: ["browser", "web_search", "send_calendar_invite"],
    excludeTools: ["send_voice_note", "send_location"],
    memoryNamespace: "study",
  },

  fit: {
    id: "fit",
    name: "Fitness Coach",
    prefix: "fit:",
    systemPromptExtension: `
You are now in FIT mode — a personal fitness and wellness coach.
- Tone: motivational, data-driven, supportive. Use energy and encouragement.
- Focus areas: workout planning, nutrition tracking, health data analysis, accountability.
- When planning workouts: specify sets, reps, rest times. Adapt to their level.
- When tracking nutrition: estimate macros, suggest meals, track daily intake.
- Reference their health data (steps, heart rate) from device context when available.
- Proactively check in on workout adherence and suggest recovery days.
- Use web_search for: exercise form guides, nutrition info, supplement research.`,
    priorityTools: ["web_search"],
    excludeTools: ["browser", "send_location"],
    memoryNamespace: "fitness",
  },
};

// ---------------------------------------------------------------------------
// Prefix detection
// ---------------------------------------------------------------------------

const PREFIX_PATTERN = /^(work|study|fit):\s*/i;
const EXIT_PATTERN = /^(exit|leave|switch|default|normal|back)\s*$/i;

export interface WorkspaceResult {
  workspace: WorkspaceConfig;
  /** The message with the prefix stripped */
  cleanedMessage: string;
  /** Whether the workspace changed from what was previously active */
  switched: boolean;
}

/**
 * Detect which workspace a message belongs to.
 *
 * @param message - The raw user message
 * @param currentWorkspaceId - The currently active workspace (from UserState.data.workspace)
 * @returns The resolved workspace config and cleaned message
 */
export function resolveWorkspace(
  message: string,
  currentWorkspaceId: string | null,
): WorkspaceResult {
  // Check for explicit exit
  if (EXIT_PATTERN.test(message.trim())) {
    return {
      workspace: WORKSPACES.default,
      cleanedMessage: message.replace(EXIT_PATTERN, "").trim() || "Hey!",
      switched: currentWorkspaceId !== null && currentWorkspaceId !== "default",
    };
  }

  // Check for workspace prefix
  const match = message.match(PREFIX_PATTERN);
  if (match) {
    const workspaceId = match[1].toLowerCase();
    const workspace = WORKSPACES[workspaceId] ?? WORKSPACES.default;
    const cleanedMessage = message.replace(PREFIX_PATTERN, "").trim();
    return {
      workspace,
      cleanedMessage: cleanedMessage || `I'm ready to help in ${workspace.name} mode.`,
      switched: currentWorkspaceId !== workspaceId,
    };
  }

  // Sticky — stay in current workspace if one is active
  if (currentWorkspaceId && WORKSPACES[currentWorkspaceId]) {
    return {
      workspace: WORKSPACES[currentWorkspaceId],
      cleanedMessage: message,
      switched: false,
    };
  }

  // Default workspace
  return {
    workspace: WORKSPACES.default,
    cleanedMessage: message,
    switched: false,
  };
}

/**
 * Get a workspace config by ID.
 */
export function getWorkspace(id: string): WorkspaceConfig {
  return WORKSPACES[id] ?? WORKSPACES.default;
}

/**
 * Get all available workspaces (for help text).
 */
export function listWorkspaces(): WorkspaceConfig[] {
  return Object.values(WORKSPACES);
}

/**
 * Filter tool definitions based on workspace config.
 */
export function filterToolsForWorkspace<T extends { function: { name: string } }>(
  tools: T[],
  workspace: WorkspaceConfig,
): T[] {
  if (workspace.id === "default") return tools;

  return tools.filter((tool) => {
    // Exclude blacklisted tools
    if (workspace.excludeTools.includes(tool.function.name)) return false;
    return true;
  });
}

/**
 * Build the switch notification message.
 */
export function buildSwitchMessage(workspace: WorkspaceConfig): string {
  if (workspace.id === "default") {
    return "Switched back to general mode.";
  }
  return `Switched to ${workspace.name} mode. ${getWorkspaceHint(workspace.id)}`;
}

function getWorkspaceHint(id: string): string {
  switch (id) {
    case "work":
      return "I can help with emails, meetings, and task management.";
    case "study":
      return "I can help with homework, exam prep, and study planning.";
    case "fit":
      return "I can help with workouts, nutrition, and tracking your fitness goals.";
    default:
      return "";
  }
}
