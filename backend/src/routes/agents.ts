import { Router } from "express";
import { prisma } from "../lib/db.js";
import { testAgentMessage } from "../lib/agentRuntime.js";
import { provisionNumber, releaseNumber } from "../lib/twilio/numberProvisioner.js";

export const agentsRouter = Router();

agentsRouter.get("/", async (_req, res) => {
  const agents = await prisma.agent.findMany({
    orderBy: { created_at: "desc" },
    take: 24,
    select: {
      id: true,
      short_id: true,
      name: true,
      description: true,
      phone_number: true,
      active: true,
      created_at: true,
    },
  });
  return res.json(agents);
});

agentsRouter.get("/:id", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ message: "Agent not found" });
  return res.json(agent);
});

agentsRouter.get("/:id/conversations", async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const userPhone = req.query.user_phone as string | undefined;

  try {
    const where: Record<string, unknown> = { agent_id: id };
    if (userPhone) where.user_phone = userPhone;

    const messages = await prisma.conversation.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
    });
    return res.json(messages);
  } catch (e) {
    console.error("Conversations fetch failed:", e);
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
});

/* ------------------------------------------------------------------ */
/*  Agent Actions: test, deploy, delete                                */
/* ------------------------------------------------------------------ */

/**
 * POST /api/agents/:id/test — send a test message (no Twilio, direct LLM)
 */
agentsRouter.post("/:id/test", async (req, res) => {
  const { id } = req.params;
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const result = await testAgentMessage(id, message);
    return res.json({
      reply: result.reply,
      agent_name: result.agentName,
      state_updated: result.stateUpdated,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agents/:id/test] Error:`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/agents/:id/deploy — provision a Twilio number and activate
 */
agentsRouter.post("/:id/deploy", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await provisionNumber(id);
    return res.json({
      phone_number: result.phoneNumber,
      sid: result.sid,
      status: "deployed",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agents/:id/deploy] Error:`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/agents/:id — deactivate agent and release phone number
 */
agentsRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Release phone number if assigned
    if (agent.phone_number) {
      await releaseNumber(id);
    }

    // Deactivate (soft delete — keep data for analytics)
    await prisma.agent.update({
      where: { id },
      data: { active: false },
    });

    return res.json({ status: "deleted", id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agents/:id DELETE] Error:`, msg);
    return res.status(500).json({ error: msg });
  }
});

agentsRouter.get("/:id/pipeline-runs/:runId", async (req, res) => {
  const { id, runId } = req.params;
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        agent_id: string;
        prompt: string;
        intent: unknown;
        artifact: unknown;
        quality_score: number;
        quality_breakdown: unknown;
        created_at: Date;
      }>
    >(
      `SELECT id, agent_id, prompt, intent, artifact, quality_score, quality_breakdown, created_at
       FROM pipeline_runs
       WHERE id = $1 AND agent_id = $2
       LIMIT 1`,
      runId,
      id,
    );
    const item = rows[0];
    if (!item) return res.status(404).json({ message: "Pipeline run not found" });
    return res.json({ ...item, created_at: item.created_at.toISOString() });
  } catch (e) {
    console.error("Pipeline run fetch failed:", e);
    return res.status(404).json({ message: "Pipeline run not found" });
  }
});
