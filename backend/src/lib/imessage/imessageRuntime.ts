/**
 * iMessage Runtime — connects the iMessage watcher to the agent runtime.
 *
 * When a new iMessage arrives:
 * 1. Look up which agent is assigned to this Mac's Apple ID
 * 2. Route through the same agent runtime (LLM call, state management)
 * 3. Send reply back as iMessage (blue bubble)
 *
 * For MVP: a single agent is assigned to this Mac via IMESSAGE_AGENT_ID env var.
 * Future: multi-agent routing via phone number → agent mapping.
 */
import {
  startIMessageWatcher,
  stopIMessageWatcher,
  sendIMessage,
  getRecentIncoming,
  getChatHistory,
} from "./imessageClient.js";
import type { IMessage } from "./imessageClient.js";
import { prisma } from "../db.js";
import {
  getOrCreateUserState,
  updateUserState,
  incrementConversationCount,
  saveMessage,
} from "../conversationState.js";
import { getRawLLMClient } from "../unifiedClient.js";
import type { AgentSpec, AgentConfig } from "../../types/index.js";
import { DEFAULT_AGENT_CONFIG } from "../../types/index.js";
import {
  downloadAttachment,
  isImageAttachment,
  attachmentExists,
} from "@photon-ai/imessage-kit";
import { sendContactCard } from "./contactCard.js";
import { selectRelevantTools, executeTool, isPlaceQuery, flushPendingLocationPin } from "./agentTools.js";
import { destroyUserSessions } from "../browser/browserSession.js";
import { buildFullContext } from "./contextEngine.js";
import { extractMemories } from "./memoryEngine.js";
import { maybeAutoSetupProactive } from "./proactiveEngine.js";
import { analyzeScreen, buildScreenContext } from "./screenPipeline.js";
import { resolveWorkspace, filterToolsForWorkspace, buildSwitchMessage } from "./workspaceRouter.js";

import { registerTapbackHandler } from "./tapbackHandler.js";
import { registerShortcutFeedback } from "./shortcutFeedback.js";
import { registerProactiveEngine } from "./proactiveEngine.js";
import { registerLiveActivities } from "./liveActivities.js";
import { registerGroupChat } from "./groupChat.js";
import { markRead } from "./nativeBridge.js";
import {
  onMessageReceived,
  onThinkingStart,
  onToolStart,
  onToolEnd,
  onReadyToSend,
  onMessageSent,
  shouldReact,
  getThreadProfile,
} from "./presenceEngine.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

/**
 * Start the iMessage runtime — begins watching for messages
 * and routing them to the configured agent.
 */
export async function startIMessageRuntime(): Promise<void> {
  const agentId = process.env.IMESSAGE_AGENT_ID;
  if (!agentId) {
    console.log("[iMessage Runtime] IMESSAGE_AGENT_ID not set, skipping iMessage setup");
    return;
  }

  // Verify agent exists
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    console.error(`[iMessage Runtime] Agent ${agentId} not found in database`);
    return;
  }

  const spec = agent.spec as unknown as AgentSpec;
  console.log(`[iMessage Runtime] Starting for agent "${spec.name}" (${agentId})`);

  await startIMessageWatcher(
    async (msg) => handleIMessage(agentId, msg),
    (error) => console.error("[iMessage Runtime] Error:", error),
  );

  // Process any messages that arrived in the last 60s (handles startup gap)
  try {
    const missed = await getRecentIncoming(60);
    if (missed.length > 0) {
      console.log(`[iMessage Runtime] Processing ${missed.length} message(s) from startup gap`);
      for (const msg of missed) {
        await handleIMessage(agentId, msg);
      }
    }
  } catch (e) {
    console.warn("[iMessage Runtime] Startup sweep failed:", e);
  }

  // Register event bus handlers for new features
  registerTapbackHandler();
  registerShortcutFeedback();
  registerProactiveEngine();
  registerLiveActivities();
  registerGroupChat();

  console.log(`[iMessage Runtime] Active — agent "${spec.name}" is receiving iMessages`);
}

/**
 * Stop the iMessage runtime.
 */
export async function stopIMessageRuntime(): Promise<void> {
  await stopIMessageWatcher();
}

/**
 * Handle a single incoming iMessage.
 */
async function handleIMessage(agentId: string, msg: IMessage): Promise<void> {
  const userPhone = msg.sender; // phone number or email
  const body = msg.text ?? "";

  console.log(`[iMessage] From ${userPhone}: "${body.slice(0, 50)}"`);

  // Instant read receipt — fire before any processing
  markRead(userPhone).catch(() => {});

  // Check if user is in an active blind date match — intercept before normal flow
  const { handleBlindDateReply } = await import("./blindDateEngine.js");
  const blindDateHandled = await handleBlindDateReply(userPhone, body);
  if (blindDateHandled) return;

  // Load agent
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return;

  const spec = agent.spec as unknown as AgentSpec;
  const config = (agent.agent_config as unknown as AgentConfig) ?? DEFAULT_AGENT_CONFIG;

  // Load conversation history from chat.db + user state
  // Short messages (1-3 words) get less history — they rarely reference prior context
  const wordCount = body.trim().split(/\s+/).length;
  const historyLimit = wordCount <= 3 ? 5 : config.max_history_length;
  const [history, userState] = await Promise.all([
    getChatHistory(userPhone, historyLimit),
    getOrCreateUserState(agentId, userPhone),
  ]);

  // Handle first-time user — send welcome + contact card
  if (userState.conversation_count === 0) {
    await incrementConversationCount(agentId, userPhone);
    await saveMessage(agentId, userPhone, "agent", spec.welcome_message);
    await sendIMessage(userPhone, spec.welcome_message);
    // Send contact card so they can save us
    try {
      await sendContactCard(userPhone);
    } catch (e) {
      console.warn("[iMessage] Failed to send contact card:", e);
    }
    if (!body.trim()) return;
  }

  // Detect location shares — Apple Maps URLs contain GPS coordinates
  const mapsMatch = body.match(/maps\.apple\.com\/?\?.*?(?:ll|q)=([-\d.]+),([-\d.]+)/i)
    || body.match(/maps\.google\.com\/?\?.*?(?:q|ll)=([-\d.]+),([-\d.]+)/i)
    || body.match(/goo\.gl\/maps/i) ? null : null; // goo.gl shortened links can't be parsed inline
  if (mapsMatch) {
    const lat = parseFloat(mapsMatch[1]);
    const lng = parseFloat(mapsMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      const data = (userState.data as Record<string, unknown>) ?? {};
      data.location = { lat, lng, updated_at: new Date().toISOString() };
      await updateUserState(agentId, userPhone, data);
      console.log(`[iMessage] Location stored for ${userPhone}: ${lat}, ${lng}`);
    }
  }

  // Handle iCloud credential submission: "connect icloud email@x.com xxxx-xxxx-xxxx-xxxx"
  const icloudMatch = body.match(/connect\s+icloud\s+(\S+@\S+)\s+([a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})/i);
  if (icloudMatch) {
    const appleId = icloudMatch[1];
    const appPassword = icloudMatch[2];
    const credentials = `${appleId}:${appPassword}`;
    await prisma.oAuthToken.upsert({
      where: { user_phone_service: { user_phone: userPhone, service: "icloud" } },
      create: { user_phone: userPhone, service: "icloud", access_token: credentials },
      update: { access_token: credentials },
    });
    const reply = "iCloud connected. I can now look up your contacts and manage your calendar.";
    await saveMessage(agentId, userPhone, "agent", reply);
    await incrementConversationCount(agentId, userPhone);
    await sendIMessage(userPhone, reply);
    console.log(`[iMessage] iCloud connected for ${userPhone}`);
    return;
  }

  // Handle pending browser login — user is sending credentials in freeform text
  const pendingLogin = (userState.data as Record<string, unknown>)?.pending_browser_login as
    | { url: string; domain: string }
    | undefined;
  if (pendingLogin && body.trim()) {
    // Use a quick LLM call to extract username + password from freeform text
    try {
      const llm = getRawLLMClient();
      const extraction = await llm.chat.completions.create({
        model: "gemini-flash-lite-latest",
        max_tokens: 100,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'Extract the username/email and password from this message. Reply with ONLY valid JSON: {"username":"...","password":"..."}. If you cannot find both, reply: {"error":"missing credentials"}',
          },
          { role: "user", content: body },
        ],
      });
      const raw = extraction.choices[0]?.message?.content ?? "";
      const creds = JSON.parse(raw.replace(/```json?\n?|```/g, "").trim());

      if (creds.error || !creds.username || !creds.password) {
        const reply = "I couldn't find a username and password in your message. Send them in any format — like \"my email is x@y.com and password is abc123\".";
        await saveMessage(agentId, userPhone, "agent", reply);
        await incrementConversationCount(agentId, userPhone);
        await sendIMessage(userPhone, reply);
        return;
      }

      // Clear pending state before attempting login
      await updateUserState(agentId, userPhone, { pending_browser_login: null });

      const { createSession, getSessionForUser, destroyUserSessions } = await import("../browser/browserSession.js");
      await createSession(userPhone);
      const session = getSessionForUser(userPhone)!;
      session.credentialsProvided = true;

      console.log(`[iMessage] Login: navigating to ${pendingLogin.url}`);
      await session.goTo(pendingLogin.url);
      const elementsText = await session.getInteractiveElements();
      console.log(`[iMessage] Login: elements on page:\n${elementsText}`);

      // Find form fields automatically
      const elements = (session as any).elements as Array<{
        index: number; tag: string; type?: string; text: string; selector: string;
      }>;
      const emailField = elements.find(
        (e) => e.tag === "input" && (e.type === "text" || e.type === "email" || !e.type),
      );
      const passField = elements.find((e) => e.tag === "input" && e.type === "password");
      // Match login buttons more broadly — buttons, submit inputs, or role=button
      const loginBtn = elements.find(
        (e) => (e.tag === "button" || (e.tag === "input" && e.type === "submit") ||
               (e.tag === "a" && /log\s*in|sign\s*in/i.test(e.text))) &&
               /log\s*in|sign\s*in|submit|next|continue/i.test(e.text),
      ) ?? elements.find(
        (e) => e.tag === "button" || (e.tag === "input" && e.type === "submit"),
      );

      console.log(`[iMessage] Login: email=${emailField?.index}, pass=${passField?.index}, btn=${loginBtn?.index}`);

      if (emailField) await session.type(emailField.index, creds.username);
      if (passField) await session.type(passField.index, creds.password);
      if (loginBtn) {
        await session.click(loginBtn.index);
      } else if (passField) {
        // No button found — try pressing Enter on the password field
        const page = (session as any).page;
        if (page) await page.keyboard.press("Enter");
      }

      // Wait for navigation after login
      await new Promise((r) => setTimeout(r, 3000));
      const postLoginUrl = session.getCurrentUrl();
      const pageText = await session.extractText();
      console.log(`[iMessage] Login: post-login URL = ${postLoginUrl}`);
      console.log(`[iMessage] Login: page text (first 200): ${pageText.slice(0, 200)}`);
      await destroyUserSessions(userPhone);

      // Check success: if URL changed away from login page, it likely worked
      const urlChanged = postLoginUrl !== pendingLogin.url && !postLoginUrl.includes("login");
      const hasErrorMsg = /invalid password|incorrect credentials|wrong password|authentication failed|login failed/i.test(pageText);
      const failed = hasErrorMsg || (!urlChanged && passField != null);

      const reply = failed
        ? "Login failed — double-check your credentials and send them again."
        : `Logged in to ${pendingLogin.domain} successfully! Cookies saved so you won't need to do this again. Try your original request now.`;
      await saveMessage(agentId, userPhone, "agent", reply);
      await incrementConversationCount(agentId, userPhone);
      await sendIMessage(userPhone, reply);
      console.log(`[iMessage] Browser login ${failed ? "failed" : "succeeded"} for ${pendingLogin.domain} by ${userPhone}`);
    } catch (e) {
      await updateUserState(agentId, userPhone, { pending_browser_login: null });
      const reply = "Something went wrong with the login. Send your credentials again and I'll retry.";
      await saveMessage(agentId, userPhone, "agent", reply);
      await incrementConversationCount(agentId, userPhone);
      await sendIMessage(userPhone, reply);
      console.error("[iMessage] Browser login error:", e);
    }
    return;
  }

  // Handle photo/screenshot attachments via Screen Understanding Pipeline
  let visionContext = "";
  if (msg.attachments.length > 0) {
    const imageAttachment = msg.attachments.find((a) => isImageAttachment(a));
    if (imageAttachment && (await attachmentExists(imageAttachment))) {
      try {
        const rawPath = path.join(os.tmpdir(), `bit7-${Date.now()}-raw`);
        const jpgPath = rawPath + ".jpg";
        await downloadAttachment(imageAttachment, rawPath);
        // Convert to JPEG (handles HEIC and other formats)
        execSync(`sips -s format jpeg "${rawPath}" --out "${jpgPath}"`, { stdio: "ignore" });
        const imageBuffer = fs.readFileSync(jpgPath);
        const base64 = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
        // Use the multi-stage screen pipeline instead of simple analyzeImage
        const screenAnalysis = await analyzeScreen(base64);
        visionContext = buildScreenContext(screenAnalysis);
        console.log(`[iMessage] Screen pipeline: type=${screenAnalysis.type}, actions=${screenAnalysis.suggested_actions.length}`);
        // Clean up temp files
        fs.unlinkSync(rawPath);
        fs.unlinkSync(jpgPath);
      } catch (e) {
        console.warn("[iMessage] Vision analysis failed:", e);
        visionContext = "(Unable to process the attached image)";
      }
    }
  }

  // Workspace routing — check for prefix or sticky workspace
  const currentWorkspaceId = (userState.data as Record<string, unknown>)?.workspace as string | null;
  const workspaceResult = resolveWorkspace(body, currentWorkspaceId);
  const workspace = workspaceResult.workspace;

  // Persist workspace switch
  if (workspaceResult.switched) {
    await updateUserState(agentId, userPhone, { workspace: workspace.id });
    if (workspace.id !== "default") {
      const switchMsg = buildSwitchMessage(workspace);
      await saveMessage(agentId, userPhone, "agent", switchMsg);
      await incrementConversationCount(agentId, userPhone);
      await sendIMessage(userPhone, switchMsg);
    }
  }

  // Presence layer — human-like read + typing timing
  await onMessageReceived(userPhone, body);

  // Check if this message just needs a reaction (no reply)
  const reactionDecision = shouldReact(body, getThreadProfile(userPhone));
  if (reactionDecision.shouldReact && !reactionDecision.alsoReply) {
    // Just react, don't generate a full response
    // TODO: send tapback reaction via native bridge when available
    console.log(`[Presence] React-only: ${reactionDecision.reaction} to "${body.slice(0, 30)}"`);
    return;
  }

  await onThinkingStart(userPhone, body);

  // Build messages for LLM — include full context (ambient + device telemetry + memories)
  const contextBlock = await buildFullContext(userPhone, agentId, workspaceResult.cleanedMessage);
  const systemPrompt = buildSystemMessage(spec, userState.data) +
    (workspace.systemPromptExtension ? `\n\n${workspace.systemPromptExtension}` : "") +
    "\n\n" + contextBlock;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  for (const m of history) {
    messages.push({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    });
  }

  let currentMessage = workspaceResult.cleanedMessage;
  if (visionContext) {
    currentMessage = body.trim()
      ? `${body}\n\n[You can see the photo: ${visionContext}]`
      : `[You can see the photo: ${visionContext}. React naturally — don't describe it back, just respond as if you saw it yourself.]`;
  }

  // Pre-LLM: run search + send pin for place queries before the LLM even sees it
  if (isPlaceQuery(body) && !visionContext) {
    try {
      const searchResult = await executeTool("web_search", { query: body }, userPhone);
      console.log(`[iMessage] Pre-LLM place search done, injecting results`);
      currentMessage += `\n\n[Search results for their query — summarize the top 1-2 options in 1-2 sentences. Do NOT call web_search again]:\n${searchResult}`;
    } catch (e) {
      console.warn("[iMessage] Pre-LLM place search failed:", e);
    }
  }

  // Pre-LLM: if user wants to text someone and contacts aren't synced, send setup link immediately
  const textMatch = body.match(/^(?:text|message|tell|send to)\s+(.+)/i);
  if (textMatch) {
    const agentId2 = process.env.IMESSAGE_AGENT_ID ?? "";
    const state2 = await prisma.userState.findUnique({
      where: { agent_id_user_phone: { agent_id: agentId2, user_phone: userPhone } },
      select: { data: true },
    });
    const syncedContacts = (state2?.data as Record<string, unknown>)?.contacts as unknown[] | undefined;
    if (!syncedContacts || syncedContacts.length === 0) {
      // If they have some contacts (even few), they've installed the shortcut — send run link
      const hasShortcut = syncedContacts && syncedContacts.length > 0;
      const link = hasShortcut
        ? "shortcuts://run-shortcut?name=BitSeven"
        : "https://www.icloud.com/shortcuts/8fa2c96c5260445980fac1d725f45fe1";
      const setupLink = `tap this to connect your contacts\n${link}`;
      await sendIMessage(userPhone, setupLink);
      await saveMessage(agentId, userPhone, "agent", setupLink);
      await incrementConversationCount(agentId, userPhone);
      onMessageSent(userPhone);
      return;
    }
  }

  // Save incoming message
  await saveMessage(agentId, userPhone, "user", body);
  messages.push({ role: "user", content: currentMessage });

  // Agentic tool loop — LLM can call tools (web search, iPhone actions) and iterate
  const llm = getRawLLMClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolMessages: any[] = [...messages];
  let rawReply = "";
  const allRelevantTools = selectRelevantTools(body);
  // Filter tools based on active workspace
  const relevantTools = filterToolsForWorkspace(allRelevantTools, workspace);
  const llmModel = "gemini-flash-lite-latest";
  console.log(`[iMessage] Context: ${messages.length} msgs, ${relevantTools.length} tools, model=${llmModel}, workspace=${workspace.id}`);

  const maxRounds = relevantTools.some(t => t.function.name === "browser") ? 10 : 5;
  for (let round = 0; round < maxRounds; round++) {
    const completion = await llm.chat.completions.create({
      model: llmModel,
      max_tokens: 400,
      temperature: 0.7,
      messages: toolMessages,
      ...(relevantTools.length > 0 ? { tools: relevantTools, tool_choice: "auto" as const } : {}),
    });

    const choice = completion.choices[0];

    if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
      rawReply = choice.message?.content ?? "Sorry, I couldn't generate a response.";
      // Detect broken tool-call garbage in text (model sometimes outputs "functions." instead of proper tool_calls)
      if (/^functions\b|tool_call|web_search.*query|^\s*\{.*"query"/i.test(rawReply.trim()) && round === 0) {
        console.warn(`[iMessage] Detected garbage tool output, retrying without tools`);
        const retryCompletion = await llm.chat.completions.create({
          model: "gemini-flash-lite-latest",
          max_tokens: 400,
          temperature: 0.7,
          messages: toolMessages,
        });
        rawReply = retryCompletion.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
      }
      break;
    }

    toolMessages.push(choice.message);

    let needsSetup = false;
    for (const tc of choice.message.tool_calls) {
      let result: string;
      // Skip remaining tools in this round if setup is required
      if (needsSetup) {
        toolMessages.push({ role: "tool", tool_call_id: tc.id, content: "Skipped — setup required first." });
        continue;
      }
      try {
        const fn = tc as unknown as { id: string; function: { name: string; arguments: string } };
        const args = JSON.parse(fn.function.arguments ?? "{}");
        console.log(`[iMessage] Tool call ${fn.function.name}: args=${JSON.stringify(args)}`);
        await onToolStart(userPhone);
        result = await executeTool(fn.function.name, args, userPhone);
        await onToolEnd(userPhone);
        console.log(`[iMessage] Tool ${fn.function.name}: ${result.slice(0, 80)}`);
        // If the tool requires setup, send the setup message directly (preserve URLs)
        if (result.startsWith("NEEDS_SETUP:")) {
          // Format: NEEDS_SETUP:<type>:<metadata-or-msg>\n<user-facing message>
          const firstNewline = result.indexOf("\n");
          const headerLine = firstNewline > 0 ? result.slice(0, firstNewline) : result;
          const headerParts = headerLine.split(":");
          const setupType = headerParts[1]; // e.g. "login", "oauth"
          // User-facing message is everything after the first newline, or after type: prefix
          const setupMsg = firstNewline > 0
            ? result.slice(firstNewline + 1)
            : headerParts.slice(2).join(":");
          // For shortcut setup, send text then link separately for rich preview
          if (setupType === "shortcut") {
            // Check if user already has the shortcut installed (has any synced data)
            const syncState = await prisma.userState.findUnique({
              where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
              select: { data: true },
            });
            const hasSynced = !!(syncState?.data as Record<string, unknown>)?.contacts;
            const link = hasSynced
              ? "shortcuts://run-shortcut?name=BitSeven"
              : "https://www.icloud.com/shortcuts/8fa2c96c5260445980fac1d725f45fe1";
            const setupLink = `tap this to connect your contacts\n${link}`;
            await sendIMessage(userPhone, setupLink);
            await saveMessage(agentId, userPhone, "agent", setupLink);
            await incrementConversationCount(agentId, userPhone);
          } else {
            await saveMessage(agentId, userPhone, "agent", setupMsg);
            await incrementConversationCount(agentId, userPhone);
            await sendIMessage(userPhone, setupMsg);
          }
          // If this is a login setup, save the pending state so the next message triggers login
          if (setupType === "login") {
            try {
              const meta = JSON.parse(headerParts.slice(2).join(":"));
              await updateUserState(agentId, userPhone, {
                pending_browser_login: { domain: meta.domain, url: meta.url },
              });
            } catch {
              console.warn("[iMessage] Failed to parse login metadata");
            }
          }
          console.log(`[iMessage] Setup prompt sent to ${userPhone}`);
          needsSetup = true;
          result = "Setup instructions sent to user.";
        }
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
    if (needsSetup) return;
  }

  // Clean up any active browser sessions
  await destroyUserSessions(userPhone).catch(() => {});

  // Parse STATE_UPDATE blocks
  const { cleanReply: rawClean, stateUpdates } = parseStateUpdates(rawReply);
  const cleanReply = truncateToSentences(rawClean, 2) || "Sorry, I couldn't generate a response. Try again?";

  // Save and send reply
  await saveMessage(agentId, userPhone, "agent", cleanReply);
  await incrementConversationCount(agentId, userPhone);

  if (Object.keys(stateUpdates).length > 0) {
    await updateUserState(agentId, userPhone, stateUpdates);
  }

  // Presence layer — simulate realistic typing duration before sending
  const usedTools = toolMessages.length > messages.length + 1;
  await onReadyToSend(userPhone, cleanReply, body, usedTools);
  await sendIMessage(userPhone, cleanReply);
  onMessageSent(userPhone);

  console.log(`[iMessage] Reply to ${userPhone}: "${cleanReply.slice(0, 50)}"`);

  // Send any queued location pin after the reply text
  flushPendingLocationPin(userPhone).catch(() => {});

  // Post-reply hooks (fire-and-forget — don't block the response)
  // 1. Extract memories from this conversation turn
  extractMemories(userPhone, agentId, body, cleanReply).catch((e) =>
    console.warn("[iMessage] Memory extraction failed:", e),
  );

  // 2. Check if user should get proactive jobs auto-created
  const updatedState = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
  });
  if (updatedState) {
    maybeAutoSetupProactive(userPhone, agentId, updatedState.conversation_count).catch((e) =>
      console.warn("[iMessage] Proactive setup check failed:", e),
    );
  }
}

function buildSystemMessage(
  spec: AgentSpec,
  userData: Record<string, unknown>,
): string {
  let systemMsg = spec.system_prompt;
  systemMsg += `\n\nTone: talk like a friend texting. all lowercase. skip commas and periods mostly. keep it short and natural. dont be formal or robotic. no emojis unless it fits. max 2 sentences per reply. never say you will look something up — just use a tool. if you dont know just say idk and ask what they need. if someone sends a photo with no text just react casually in a few words.`;
  systemMsg += `\n\nYou have tools available. Use web_search for any question needing current information. Use iphone_action for calendar events and reminders (via iCloud). For email, music, calendar, Slack, GitHub, Notion, Drive, Twitter, LinkedIn — use composio_action (real APIs). For everything else (Instagram, Canvas, DoorDash, Amazon, etc.) — use the browser tool. When user says "text [name]" — ALWAYS call lookup_contact first, never ask for a number.`;
  systemMsg += `\n\nLocation rules: When searching for restaurants, food, stores, or any physical place, ALWAYS include "open now" in your search query. Never recommend a place without confirming it's currently open. Use the user's location from context for all location-based searches. If you only have a general area and the user asks for nearby places, ask them to share their location for better results.`;
  systemMsg += `\n\nRich media tools — USE THESE to make responses visual and interactive:
- send_location: ALWAYS send a map pin when mentioning a place, restaurant, store, or address. Just call send_location with the place name — coordinates are resolved automatically. The pin appears directly in the iMessage chat as a tappable map preview — it does NOT open the Maps app. Never say "sent to your maps app" — just say something like "here's the pin" or confirm the place casually.
- send_calendar_invite: When creating or suggesting an event, send a tappable .ics invite so they can add it with one tap.
- send_voice_note: When asked to speak, read aloud, or send audio.
- send_image: When the user asks to see something, search for an image URL then send it inline.
After sending rich media, confirm in one sentence.`;
  systemMsg += `\n\nComposio (composio_action) — PREFERRED for: Spotify, Gmail, Google Calendar, Slack, GitHub, Notion, Google Drive, Twitter, LinkedIn.
- Uses real APIs with OAuth — faster, more reliable, and richer than browser scraping.
- If the user hasn't connected the service, the tool returns an OAuth link — send it to them.
- Once connected, actions work instantly forever (tokens auto-refresh).
- Use specific action names: SPOTIFY_PLAY_TRACK, GMAIL_SEND_EMAIL, GOOGLECALENDAR_CREATE_EVENT, etc.
- If you're not sure of the action name, call composio_action(action: "search", params: {description: "what to do"}).
- ALWAYS prefer composio_action over browser for supported services.`;
  systemMsg += `\n\nBrowser tool — FALLBACK for websites NOT covered by composio_action (Instagram, Canvas, DoorDash, Amazon, etc.):
- Use browser ONLY when composio_action doesn't support the service.
- Call browser(action: "start") then "go_to" with the URL, then "extract_text" or "get_elements".
- Interact by element number: "click" or "type" with the element number from get_elements.
- Always call "stop" when done.
- Login pages are handled automatically.
- Cookies are saved so the user only needs to log in once per site.`;
  systemMsg += `\n\nLive Tracking — use start_tracking to set up periodic updates:
- "track my package" → start_tracking(type:"package", identifier:"tracking_number")
- "follow the Lakers game" → start_tracking(type:"sports", identifier:"Lakers")
- "track my flight UA123" → start_tracking(type:"flight", identifier:"UA123")
- "set a 15 minute timer" → start_tracking(type:"timer", identifier:"15", label:"Pasta timer")`;
  systemMsg += `\n\nDeep Links — use generate_action_link to create tappable links that open native iOS apps:
- Uber rides, Spotify playlists, FaceTime calls, Venmo payments, Apple Maps directions
- Always include deep links when suggesting app actions (e.g., "want a ride?" + uber link)`;
  systemMsg += `\n\nDocuments — use create_document to generate and send PDFs:
- Cover letters, meeting notes, study guides, expense reports
- User sends a document → it's automatically summarized`;
  systemMsg += `\n\nMemory — you remember things about users across conversations. Use manage_memory when they ask what you know or want you to forget. Memories are extracted automatically — just be natural.`;
  systemMsg += `\n\nWorkspaces — users can switch modes with prefixes:
- "work:" → professional mode (email, meetings, tasks)
- "study:" → academic tutor (homework, Canvas, study planning)
- "fit:" → fitness coach (workouts, nutrition, health data)
- "exit" → back to general mode`;
  if (Object.keys(userData).length > 0) {
    systemMsg += `\n\n--- CURRENT USER DATA ---\n${JSON.stringify(userData, null, 2)}`;
  }
  return systemMsg;
}

function truncateToSentences(text: string, max: number): string {
  // Strip preambles, numbered lists, and summary lines
  let cleaned = text
    .replace(/^(got it\.?|i see (now)?\.?|ah,?\s*i see\.?|based on (the )?image|based on (the )?description|here'?s? (what|a summary)|in summary|sure(,|!)?\s*)[^.!?\n]*/im, "")
    .replace(/^\d+\.\s+/gm, "")  // remove "1. " list markers
    .replace(/\n+/g, " ")         // collapse newlines
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned];
  return sentences.slice(0, max).join(" ").trim();
}

function parseStateUpdates(reply: string): {
  cleanReply: string;
  stateUpdates: Record<string, unknown>;
} {
  const stateUpdates: Record<string, unknown> = {};
  const pattern = /\[STATE_UPDATE\]([\s\S]*?)\[\/STATE_UPDATE\]/g;
  let cleanReply = reply;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(reply)) !== null) {
    try {
      Object.assign(stateUpdates, JSON.parse(match[1]));
    } catch {
      console.warn("[iMessage] Failed to parse STATE_UPDATE:", match[1]);
    }
  }

  cleanReply = cleanReply.replace(pattern, "").trim();
  return { cleanReply, stateUpdates };
}
