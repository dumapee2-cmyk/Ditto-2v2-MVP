/**
 * Conversation State — per-user, per-agent state management via Prisma.
 * Handles conversation history and persistent user data.
 */
import { prisma } from "./db.js";
import type { ConversationMessage, UserState } from "../types/index.js";

/**
 * Get or create a user's state for an agent.
 */
export async function getOrCreateUserState(
  agentId: string,
  userPhone: string,
): Promise<UserState> {
  const existing = await prisma.userState.findUnique({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
  });

  if (existing) {
    return {
      agent_id: existing.agent_id,
      user_phone: existing.user_phone,
      data: existing.data as Record<string, unknown>,
      conversation_count: existing.conversation_count,
      last_active: existing.last_active,
    };
  }

  const created = await prisma.userState.create({
    data: {
      agent_id: agentId,
      user_phone: userPhone,
      data: {},
      conversation_count: 0,
    },
  });

  return {
    agent_id: created.agent_id,
    user_phone: created.user_phone,
    data: created.data as Record<string, unknown>,
    conversation_count: created.conversation_count,
    last_active: created.last_active,
  };
}

/**
 * Update a user's persistent data (merge with existing).
 */
export async function updateUserState(
  agentId: string,
  userPhone: string,
  data: Record<string, unknown>,
): Promise<void> {
  const existing = await getOrCreateUserState(agentId, userPhone);
  const merged = { ...existing.data, ...data };

  await prisma.userState.update({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
    data: {
      data: merged as object,
      last_active: new Date(),
    },
  });
}

/**
 * Increment conversation count and update last_active.
 */
export async function incrementConversationCount(
  agentId: string,
  userPhone: string,
): Promise<void> {
  await prisma.userState.upsert({
    where: { agent_id_user_phone: { agent_id: agentId, user_phone: userPhone } },
    create: {
      agent_id: agentId,
      user_phone: userPhone,
      data: {},
      conversation_count: 1,
    },
    update: {
      conversation_count: { increment: 1 },
      last_active: new Date(),
    },
  });
}

/**
 * Get recent conversation history for a user with an agent.
 */
export async function getConversationHistory(
  agentId: string,
  userPhone: string,
  limit: number = 50,
): Promise<ConversationMessage[]> {
  const messages = await prisma.conversation.findMany({
    where: { agent_id: agentId, user_phone: userPhone },
    orderBy: { created_at: "desc" },
    take: limit,
  });

  // Return in chronological order
  return messages.reverse().map((m) => ({
    id: m.id,
    agent_id: m.agent_id,
    user_phone: m.user_phone,
    role: m.role as "user" | "agent",
    content: m.content,
    media_url: m.media_url ?? undefined,
    media_type: m.media_type ?? undefined,
    created_at: m.created_at,
  }));
}

/**
 * Save a message to conversation history.
 */
export async function saveMessage(
  agentId: string,
  userPhone: string,
  role: "user" | "agent",
  content: string,
  mediaUrl?: string,
  mediaType?: string,
): Promise<void> {
  await prisma.conversation.create({
    data: {
      agent_id: agentId,
      user_phone: userPhone,
      role,
      content,
      media_url: mediaUrl,
      media_type: mediaType,
    },
  });
}
