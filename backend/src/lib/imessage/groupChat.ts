/**
 * Group Chat Intelligence — polls, bill splitting, schedule coordination, summarization.
 *
 * The agent only responds in group chats when:
 * - Directly mentioned ("@Bit7", "hey Bit7")
 * - A group-specific feature is triggered (vote, split, summarize)
 *
 * Group state (polls, shared lists) is stored in UserState.data keyed by chatId.
 */
import type { GroupMessageEvent } from "./eventBus.js";
import { eventBus } from "./eventBus.js";
import { sendIMessage } from "./imessageClient.js";
import { prisma } from "../db.js";
import { saveMessage, incrementConversationCount } from "../conversationState.js";
import { getRawLLMClient } from "../unifiedClient.js";
import { generateDeepLink } from "./deepLinks.js";
import { getChatHistory } from "./imessageClient.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Poll {
  question: string;
  options: string[];
  votes: Record<string, string>; // sender → chosen option
  createdAt: string;
  createdBy: string;
}

interface SharedList {
  name: string;
  items: Array<{ text: string; addedBy: string; done: boolean }>;
}

interface GroupState {
  active_poll?: Poll | null;
  shared_lists?: Record<string, SharedList>;
}

// ---------------------------------------------------------------------------
// Group state management
// ---------------------------------------------------------------------------

async function getGroupState(agentId: string, chatId: string): Promise<GroupState> {
  // Use chatId as the "user_phone" for group state — a hack but it works with existing schema
  const state = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: chatId } },
  });

  if (!state) {
    await prisma.userState.create({
      data: { agent_id: agentId, user_phone: chatId, data: {} },
    });
    return {};
  }

  return (state.data as Record<string, unknown> as GroupState) ?? {};
}

async function updateGroupState(agentId: string, chatId: string, updates: Partial<GroupState>): Promise<void> {
  const current = await getGroupState(agentId, chatId);
  const merged = { ...current, ...updates };

  await prisma.userState.update({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: chatId } },
    data: { data: JSON.parse(JSON.stringify(merged)) },
  });
}

// ---------------------------------------------------------------------------
// Feature: Polls
// ---------------------------------------------------------------------------

const POLL_PATTERN = /(?:let'?s?\s+)?(?:vote|poll)[\s:]+(.+)/i;
const VOTE_PATTERN = /^(\d+)$/;

function parsePollCreation(text: string): { question: string; options: string[] } | null {
  // Format: "vote: Where for dinner? 1) Thai 2) Italian 3) Sushi"
  // Or: "let's vote on dinner: Thai, Italian, Sushi"
  const match = text.match(POLL_PATTERN);
  if (!match) return null;

  const body = match[1].trim();

  // Try numbered format: "1) Thai 2) Italian"
  const numberedOptions = body.match(/\d+[.)]\s*[^0-9)]+/g);
  if (numberedOptions && numberedOptions.length >= 2) {
    const options = numberedOptions.map((o) => o.replace(/^\d+[.)]\s*/, "").trim());
    const question = body.split(/\d+[.)]/)[0].trim() || "Vote:";
    return { question, options };
  }

  // Try comma/or format: "Thai, Italian, or Sushi"
  const parts = body.split(/[,]|\bor\b/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { question: "Vote:", options: parts };
  }

  return null;
}

async function handlePollCreation(
  agentId: string,
  chatId: string,
  sender: string,
  question: string,
  options: string[],
): Promise<string> {
  const poll: Poll = {
    question,
    options,
    votes: {},
    createdAt: new Date().toISOString(),
    createdBy: sender,
  };

  await updateGroupState(agentId, chatId, { active_poll: poll });

  const optionList = options.map((o, i) => `${i + 1}) ${o}`).join("\n");
  return `📊 Poll: ${question}\n${optionList}\n\nReply with a number to vote!`;
}

async function handleVote(
  agentId: string,
  chatId: string,
  sender: string,
  voteNumber: number,
): Promise<string | null> {
  const state = await getGroupState(agentId, chatId);
  if (!state.active_poll) return null;

  const poll = state.active_poll;
  if (voteNumber < 1 || voteNumber > poll.options.length) return null;

  poll.votes[sender] = poll.options[voteNumber - 1];
  await updateGroupState(agentId, chatId, { active_poll: poll });

  // Check if everyone has voted (we don't know group size, so just confirm)
  const voteCount = Object.keys(poll.votes).length;
  return `Vote recorded: ${poll.options[voteNumber - 1]} (${voteCount} vote${voteCount > 1 ? "s" : ""} so far)`;
}

function tallyPoll(poll: Poll): string {
  const counts: Record<string, number> = {};
  for (const option of poll.options) counts[option] = 0;
  for (const vote of Object.values(poll.votes)) {
    counts[vote] = (counts[vote] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const results = sorted.map(([option, count]) => `${option}: ${count} vote${count !== 1 ? "s" : ""}`).join("\n");
  const winner = sorted[0][0];
  const total = Object.keys(poll.votes).length;

  return `📊 Results (${total} votes):\n${results}\n\n${winner} wins!`;
}

// ---------------------------------------------------------------------------
// Feature: Bill Splitting
// ---------------------------------------------------------------------------

const SPLIT_PATTERN = /split\s+\$?(\d+(?:\.\d{1,2})?)\s*(?:(\d+)\s*ways?)?/i;

function handleBillSplit(text: string, participantCount?: number): string | null {
  const match = text.match(SPLIT_PATTERN);
  if (!match) return null;

  const total = parseFloat(match[1]);
  const ways = parseInt(match[2] ?? String(participantCount ?? 2), 10);
  const perPerson = (total / ways).toFixed(2);

  const venmoLink = generateDeepLink("venmo", {
    amount: perPerson,
    note: `Split $${total.toFixed(2)} ${ways} ways`,
    user: "",
  });

  let message = `💰 Bill Split: $${total.toFixed(2)} ÷ ${ways} = $${perPerson} each`;

  if (venmoLink) {
    message += `\n\nPay via Venmo: ${venmoLink}`;
  }

  return message;
}

// ---------------------------------------------------------------------------
// Feature: Thread Summarizer
// ---------------------------------------------------------------------------

const SUMMARIZE_PATTERN = /what did i miss|summarize|catch me up|tldr|tl;dr/i;

async function summarizeThread(chatId: string): Promise<string> {
  try {
    const history = await getChatHistory(chatId, 50);
    if (history.length === 0) return "No recent messages to summarize.";

    const transcript = history
      .map((m) => `${m.role === "user" ? "Someone" : "Bit7"}: ${m.content}`)
      .join("\n")
      .slice(0, 2000);

    const llm = getRawLLMClient();
    const completion = await llm.chat.completions.create({
      model: "gemini-flash-lite-latest",
      max_tokens: 200,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "Summarize this group chat thread in 3-5 bullet points. Focus on decisions made, questions asked, and action items. Be concise.",
        },
        { role: "user", content: transcript },
      ],
    });

    return completion.choices[0]?.message?.content ?? "Couldn't summarize — not enough context.";
  } catch {
    return "Couldn't summarize the thread right now.";
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleGroupMessage(event: GroupMessageEvent): Promise<void> {
  const agentId = process.env.IMESSAGE_AGENT_ID;
  if (!agentId) return;

  const { sender, text, chatId } = event;
  const lower = text.toLowerCase().trim();

  // Check if we should respond at all
  const shouldRespond =
    event.mentionsAgent ||
    POLL_PATTERN.test(text) ||
    VOTE_PATTERN.test(lower) ||
    SPLIT_PATTERN.test(text) ||
    SUMMARIZE_PATTERN.test(text) ||
    lower.includes("poll results") ||
    lower.includes("end poll") ||
    lower.includes("close poll");

  if (!shouldRespond) return;

  let reply: string | null = null;

  // Poll vote (just a number)
  const voteMatch = lower.match(VOTE_PATTERN);
  if (voteMatch) {
    reply = await handleVote(agentId, chatId, sender, parseInt(voteMatch[1], 10));
    if (!reply) return; // No active poll, ignore the number
  }

  // Poll creation
  if (!reply) {
    const pollData = parsePollCreation(text);
    if (pollData) {
      reply = await handlePollCreation(agentId, chatId, sender, pollData.question, pollData.options);
    }
  }

  // Poll results / end poll
  if (!reply && (/poll results|end poll|close poll/i.test(text))) {
    const state = await getGroupState(agentId, chatId);
    if (state.active_poll) {
      reply = tallyPoll(state.active_poll);
      await updateGroupState(agentId, chatId, { active_poll: null });
    } else {
      reply = "No active poll right now.";
    }
  }

  // Bill splitting
  if (!reply) {
    reply = handleBillSplit(text, event.participants.length);
  }

  // Thread summarizer
  if (!reply && SUMMARIZE_PATTERN.test(text)) {
    reply = await summarizeThread(chatId);
  }

  // General mention — use LLM to respond
  if (!reply && event.mentionsAgent) {
    const llm = getRawLLMClient();
    const completion = await llm.chat.completions.create({
      model: "gemini-flash-lite-latest",
      max_tokens: 200,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are Bit7, an AI assistant in a group chat. " +
            "Someone mentioned you. Reply in 1-2 sentences. Be helpful and casual. " +
            "Available group features: polls ('let's vote: option1, option2'), " +
            "bill splitting ('split $50 3 ways'), thread summaries ('what did I miss').",
        },
        { role: "user", content: text },
      ],
    });
    reply = completion.choices[0]?.message?.content ?? null;
  }

  if (!reply) return;

  // Send to the group chat
  await saveMessage(agentId, chatId, "agent", reply);
  await incrementConversationCount(agentId, chatId);
  await sendIMessage(chatId, reply);
  console.log(`[GroupChat] Replied in ${chatId}: "${reply.slice(0, 50)}"`);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGroupChat(): void {
  eventBus.on("message:group", handleGroupMessage);
  console.log("[GroupChat] Handler registered");
}
