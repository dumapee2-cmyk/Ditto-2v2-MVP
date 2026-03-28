import { Router } from "express";
import { prisma } from "../lib/db.js";

export const analyticsRouter = Router();

/**
 * POST /api/agents/:id/analytics/event
 * Record an analytics event for an agent.
 */
analyticsRouter.post("/:id/analytics/event", async (req, res) => {
  const { id } = req.params;
  const { event_type, path, referrer, session_id, metadata } = req.body as {
    event_type?: string;
    path?: string;
    referrer?: string;
    session_id?: string;
    metadata?: Record<string, unknown>;
  };

  if (!event_type || !["message_received", "message_sent", "error", "custom"].includes(event_type)) {
    return res.status(400).json({ message: "Invalid event_type" });
  }

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO analytics_events (id, agent_id, event_type, path, referrer, user_agent, session_id, metadata, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      id,
      event_type,
      path ?? null,
      referrer ?? null,
      req.headers["user-agent"] ?? null,
      session_id ?? null,
      metadata ? JSON.stringify(metadata) : null,
    );
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error("[Analytics] Event insert failed:", e);
    return res.status(500).json({ message: "Failed to record event" });
  }
});

/**
 * GET /api/agents/:id/analytics
 * Read analytics summary for an agent.
 */
analyticsRouter.get("/:id/analytics", async (req, res) => {
  const { id } = req.params;
  const days = Math.min(Number(req.query.days ?? 30), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [totalMessages, uniqueUsers, dailyCounts, recentEvents] = await Promise.all([
      prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM analytics_events WHERE agent_id = $1 AND event_type = 'message_received' AND created_at >= $2`,
        id, since,
      ).then(r => Number(r[0]?.count ?? 0)),

      prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(DISTINCT session_id) as count FROM analytics_events WHERE agent_id = $1 AND session_id IS NOT NULL AND created_at >= $2`,
        id, since,
      ).then(r => Number(r[0]?.count ?? 0)),

      prisma.$queryRawUnsafe<Array<{ day: Date; count: bigint }>>(
        `SELECT DATE(created_at) as day, COUNT(*) as count FROM analytics_events WHERE agent_id = $1 AND event_type = 'message_received' AND created_at >= $2 GROUP BY DATE(created_at) ORDER BY day`,
        id, since,
      ).then(rows => rows.map(r => ({ date: r.day.toISOString().split("T")[0], messages: Number(r.count) }))),

      prisma.$queryRawUnsafe<Array<{ event_type: string; path: string | null; created_at: Date; metadata: unknown }>>(
        `SELECT event_type, path, created_at, metadata FROM analytics_events WHERE agent_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 50`,
        id, since,
      ).then(rows => rows.map(r => ({ ...r, created_at: r.created_at.toISOString() }))),
    ]);

    return res.json({
      period_days: days,
      total_messages: totalMessages,
      unique_users: uniqueUsers,
      daily: dailyCounts,
      recent_events: recentEvents,
    });
  } catch (e) {
    console.error("[Analytics] Read failed:", e);
    return res.status(500).json({ message: "Failed to read analytics" });
  }
});
