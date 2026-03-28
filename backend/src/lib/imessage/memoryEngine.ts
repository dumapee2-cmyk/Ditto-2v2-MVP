/**
 * Memory Engine — long-term memory for the iMessage agent.
 *
 * Three core operations:
 * 1. extractMemories — post-reply hook that uses a cheap LLM call to pull
 *    "remember-worthy" facts from each conversation turn.
 * 2. recallMemories — keyword-based recall that surfaces relevant memories
 *    for the current conversation.
 * 3. injectMemories — inserts a [MEMORIES] block into the system prompt
 *    so the LLM can reference past knowledge.
 */
import { prisma } from "../db.js";
import { getRawLLMClient } from "../unifiedClient.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedMemory {
  key: string;
  value: string;
  type: "preference" | "episodic" | "fact" | "pattern";
}

interface RecalledMemory {
  id: string;
  key: string;
  value: string;
  type: string;
  confidence: number;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Extract — pull memories from a conversation turn
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a user message and assistant reply, extract any personal facts worth remembering for future conversations.

Extract ONLY:
- Personal preferences (food, music, hobbies, style)
- Important facts (name, job, school, city, birthday, relationships)
- Opinions and interests ("I love X", "I hate Y")
- Recurring patterns ("every Friday I go to...", "my weekly meeting")
- Specific events worth recalling later ("job interview next Tuesday")

Do NOT extract:
- Trivial conversational filler
- Things already in the current request (weather, search results)
- Agent actions or tool results

Reply with a JSON array of objects: [{"key":"food_preference","value":"loves spicy Thai food","type":"preference"}]
If nothing is worth remembering, reply with: []

Types: "preference" | "episodic" | "fact" | "pattern"`;

/**
 * Extract memories from a conversation turn. Runs async (fire-and-forget)
 * after each reply is sent.
 */
export async function extractMemories(
  userPhone: string,
  agentId: string,
  userMessage: string,
  agentReply: string,
): Promise<void> {
  // Skip very short exchanges — unlikely to contain memorable info
  if (userMessage.length < 10 && agentReply.length < 10) return;

  try {
    const llm = getRawLLMClient();
    const completion = await llm.chat.completions.create({
      model: "gemini-flash-lite-latest",
      max_tokens: 300,
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `User said: "${userMessage}"\nAssistant replied: "${agentReply}"`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";
    const cleaned = raw.replace(/```json?\n?|```/g, "").trim();
    const memories: ExtractedMemory[] = JSON.parse(cleaned);

    if (!Array.isArray(memories) || memories.length === 0) return;

    for (const mem of memories) {
      if (!mem.key || !mem.value || !mem.type) continue;

      // Upsert — update if same key exists, create if new
      const existing = await prisma.memory.findFirst({
        where: { user_phone: userPhone, agent_id: agentId, key: mem.key },
      });

      if (existing) {
        // Update if the new value adds information
        if (existing.value !== mem.value) {
          await prisma.memory.update({
            where: { id: existing.id },
            data: {
              value: mem.value,
              confidence: Math.min(existing.confidence + 0.1, 1.0),
              accessed_at: new Date(),
            },
          });
          console.log(`[Memory] Updated: ${mem.key} = "${mem.value}"`);
        }
      } else {
        await prisma.memory.create({
          data: {
            user_phone: userPhone,
            agent_id: agentId,
            type: mem.type,
            key: mem.key,
            value: mem.value,
            confidence: 0.8, // Start at 0.8, grows with reinforcement
          },
        });
        console.log(`[Memory] Stored: ${mem.key} = "${mem.value}"`);
      }
    }
  } catch (e) {
    // Memory extraction is best-effort — never block the main flow
    console.warn("[Memory] Extraction failed:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// Recall — find relevant memories for a query
// ---------------------------------------------------------------------------

/**
 * Recall memories relevant to the current message.
 * Uses keyword matching (v1). Returns top-K by relevance score.
 */
export async function recallMemories(
  userPhone: string,
  agentId: string,
  query: string,
  maxResults: number = 5,
): Promise<RecalledMemory[]> {
  // Pull all memories for this user (bounded — heavy users might have ~100)
  const allMemories = await prisma.memory.findMany({
    where: { user_phone: userPhone, agent_id: agentId },
    orderBy: { accessed_at: "desc" },
    take: 200,
  });

  if (allMemories.length === 0) return [];

  // Score each memory by keyword overlap with the query
  const queryWords = new Set(
    query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  const scored = allMemories.map((mem) => {
    const memWords = `${mem.key} ${mem.value}`
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/);

    let matchScore = 0;
    for (const word of memWords) {
      if (queryWords.has(word)) matchScore++;
    }

    // Boost recent memories and high-confidence ones
    const ageHours = (Date.now() - mem.accessed_at.getTime()) / (1000 * 60 * 60);
    const recencyBoost = Math.max(0, 1 - ageHours / (24 * 30)); // decays over 30 days
    const score = matchScore * mem.confidence + recencyBoost * 0.5;

    return { ...mem, score };
  });

  // Sort by score descending, return top results
  scored.sort((a, b) => b.score - a.score);
  const topMemories = scored.slice(0, maxResults).filter((m) => m.score > 0);

  // If no keyword matches, return the most recent memories as general context
  if (topMemories.length === 0) {
    return allMemories.slice(0, 3).map((m) => ({
      id: m.id,
      key: m.key,
      value: m.value,
      type: m.type,
      confidence: m.confidence,
      created_at: m.created_at,
    }));
  }

  // Touch accessed_at for recalled memories
  const recalledIds = topMemories.map((m) => m.id);
  await prisma.memory.updateMany({
    where: { id: { in: recalledIds } },
    data: { accessed_at: new Date() },
  });

  return topMemories.map((m) => ({
    id: m.id,
    key: m.key,
    value: m.value,
    type: m.type,
    confidence: m.confidence,
    created_at: m.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Inject — add memory context to the system prompt
// ---------------------------------------------------------------------------

/**
 * Build a memory context block to inject into the system prompt.
 * Returns empty string if no relevant memories found.
 */
export async function injectMemories(
  userPhone: string,
  agentId: string,
  currentMessage: string,
): Promise<string> {
  const memories = await recallMemories(userPhone, agentId, currentMessage);
  if (memories.length === 0) return "";

  const lines = memories.map(
    (m) => `- [${m.type}] ${m.key}: ${m.value}`,
  );

  return `--- MEMORIES (things you know about this user) ---\n${lines.join("\n")}\nUse these naturally — don't announce that you "remember" unless they ask. Just incorporate the knowledge.`;
}

// ---------------------------------------------------------------------------
// Management — forget, list
// ---------------------------------------------------------------------------

/**
 * Delete all memories for a user (triggered by "forget everything").
 */
export async function forgetAll(
  userPhone: string,
  agentId: string,
): Promise<number> {
  const result = await prisma.memory.deleteMany({
    where: { user_phone: userPhone, agent_id: agentId },
  });
  console.log(`[Memory] Wiped ${result.count} memories for ${userPhone}`);
  return result.count;
}

/**
 * Delete a specific memory by key.
 */
export async function forgetKey(
  userPhone: string,
  agentId: string,
  key: string,
): Promise<boolean> {
  const result = await prisma.memory.deleteMany({
    where: { user_phone: userPhone, agent_id: agentId, key },
  });
  return result.count > 0;
}

/**
 * List all memories for a user (triggered by "what do you know about me?").
 */
export async function listMemories(
  userPhone: string,
  agentId: string,
): Promise<RecalledMemory[]> {
  return prisma.memory.findMany({
    where: { user_phone: userPhone, agent_id: agentId },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      key: true,
      value: true,
      type: true,
      confidence: true,
      created_at: true,
    },
  });
}
