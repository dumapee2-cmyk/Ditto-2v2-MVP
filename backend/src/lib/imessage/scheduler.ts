/**
 * Scheduler — lightweight cron-like tick system for proactive jobs and subscriptions.
 *
 * Runs a 60-second interval in the same Node.js process. Each tick:
 * 1. Queries ProactiveJob where enabled=true AND next_run <= now
 * 2. Queries Subscription where status='active' AND due for check
 * 3. Emits events via the event bus for each due item
 */
import { prisma } from "../db.js";
import { eventBus } from "./eventBus.js";
import { runMatchingCycle, expireStaleMatches } from "./blindDateEngine.js";

const TICK_INTERVAL_MS = 60_000; // 60 seconds
const MAX_PROACTIVE_PER_DAY = 3;

let tickInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the scheduler. Call once from server.ts alongside startIMessageRuntime().
 */
export async function startScheduler(): Promise<void> {
  if (tickInterval) {
    console.warn("[Scheduler] Already running");
    return;
  }

  console.log("[Scheduler] Starting (60s tick interval)");

  // Run first tick immediately
  await tick();

  tickInterval = setInterval(async () => {
    try {
      await tick();
    } catch (e) {
      console.error("[Scheduler] Tick error:", e);
    }
  }, TICK_INTERVAL_MS);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log("[Scheduler] Stopped");
  }
}

// ---------------------------------------------------------------------------
// Tick — the core loop
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  const now = new Date();

  await Promise.all([
    processProactiveJobs(now),
    processSubscriptions(now),
    runMatchingCycle().catch((e) => console.error("[Scheduler] BlindDate matching error:", e)),
    expireStaleMatches().catch((e) => console.error("[Scheduler] BlindDate expiry error:", e)),
  ]);
}

// ---------------------------------------------------------------------------
// Proactive Jobs
// ---------------------------------------------------------------------------

async function processProactiveJobs(now: Date): Promise<void> {
  // Find all due jobs
  const dueJobs = await prisma.proactiveJob.findMany({
    where: {
      enabled: true,
      next_run: { lte: now },
    },
    take: 20, // Process at most 20 per tick
  });

  for (const job of dueJobs) {
    // Rate limit: check how many proactive messages we sent today
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayCount = await prisma.proactiveJob.count({
      where: {
        user_phone: job.user_phone,
        agent_id: job.agent_id,
        last_run: { gte: todayStart },
      },
    });

    if (todayCount >= MAX_PROACTIVE_PER_DAY) {
      // Reschedule to tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0); // Default to 8 AM
      await prisma.proactiveJob.update({
        where: { id: job.id },
        data: { next_run: tomorrow },
      });
      console.log(`[Scheduler] Rate limited proactive for ${job.user_phone}, rescheduled to tomorrow`);
      continue;
    }

    // Emit the proactive event
    eventBus.emit("proactive:trigger", {
      jobId: job.id,
      userPhone: job.user_phone,
      agentId: job.agent_id,
      type: job.type,
      config: job.config as Record<string, unknown>,
    });

    // Update last_run and compute next_run
    const nextRun = computeNextRun(job.schedule, now);
    await prisma.proactiveJob.update({
      where: { id: job.id },
      data: {
        last_run: now,
        next_run: nextRun,
        // Disable one-shot jobs
        enabled: nextRun !== null,
      },
    });

    console.log(`[Scheduler] Fired proactive: ${job.type} for ${job.user_phone}`);
  }
}

// ---------------------------------------------------------------------------
// Subscriptions (Live Activities)
// ---------------------------------------------------------------------------

async function processSubscriptions(now: Date): Promise<void> {
  // Find subscriptions due for a check
  const dueSubs = await prisma.subscription.findMany({
    where: {
      status: "active",
    },
  });

  // Filter in code — check if enough time has passed since last_check
  const readySubs = dueSubs.filter((sub) => {
    const elapsed = now.getTime() - sub.last_check.getTime();
    return elapsed >= sub.interval_ms;
  });

  for (const sub of readySubs) {
    eventBus.emit("subscription:update", {
      subscriptionId: sub.id,
      userPhone: sub.user_phone,
      agentId: sub.agent_id,
      type: sub.type,
      previousState: sub.last_state as Record<string, unknown> | null,
      currentState: {}, // Filled by the handler after checking
    });

    // Update last_check
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { last_check: now },
    });
  }
}

// ---------------------------------------------------------------------------
// Schedule parsing
// ---------------------------------------------------------------------------

/**
 * Compute the next run time from a schedule string.
 *
 * Supported formats:
 * - "once:2026-03-21T08:00:00" — one-shot, returns null after firing
 * - "daily:HH:MM" — runs daily at HH:MM local time
 * - "interval:MINUTES" — runs every N minutes from now
 * - "weekly:DAY:HH:MM" — runs weekly (DAY = 0-6, Sun-Sat)
 */
function computeNextRun(schedule: string, now: Date): Date | null {
  const [type, ...rest] = schedule.split(":");

  switch (type) {
    case "once":
      return null; // One-shot, disable after firing

    case "daily": {
      const [hours, minutes] = rest[0].split(":").map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      // If today's time has passed, schedule for tomorrow
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }

    case "interval": {
      const mins = parseInt(rest[0], 10);
      return new Date(now.getTime() + mins * 60_000);
    }

    case "weekly": {
      const dayOfWeek = parseInt(rest[0], 10);
      const [hours, minutes] = rest[1].split(":").map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      const currentDay = next.getDay();
      let daysUntil = dayOfWeek - currentDay;
      if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
        daysUntil += 7;
      }
      next.setDate(next.getDate() + daysUntil);
      return next;
    }

    default:
      console.warn(`[Scheduler] Unknown schedule format: ${schedule}`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helper — create a proactive job for a user
// ---------------------------------------------------------------------------

/**
 * Create or update a proactive job. Idempotent by (user_phone, agent_id, type).
 */
export async function upsertProactiveJob(params: {
  userPhone: string;
  agentId: string;
  type: string;
  schedule: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<void> {
  const existing = await prisma.proactiveJob.findFirst({
    where: {
      user_phone: params.userPhone,
      agent_id: params.agentId,
      type: params.type,
    },
  });

  const nextRun = computeNextRun(params.schedule, new Date());

  if (existing) {
    await prisma.proactiveJob.update({
      where: { id: existing.id },
      data: {
        schedule: params.schedule,
        config: params.config ? JSON.parse(JSON.stringify(params.config)) : undefined,
        enabled: params.enabled ?? existing.enabled,
        next_run: nextRun,
      },
    });
  } else {
    await prisma.proactiveJob.create({
      data: {
        user_phone: params.userPhone,
        agent_id: params.agentId,
        type: params.type,
        schedule: params.schedule,
        config: JSON.parse(JSON.stringify(params.config ?? {})),
        next_run: nextRun,
      },
    });
  }

  console.log(`[Scheduler] Upserted ${params.type} job for ${params.userPhone} (next: ${nextRun})`);
}

/**
 * Disable all proactive jobs for a user (triggered by "stop briefings").
 */
export async function disableAllJobs(
  userPhone: string,
  agentId: string,
  type?: string,
): Promise<number> {
  const where: Record<string, unknown> = { user_phone: userPhone, agent_id: agentId };
  if (type) where.type = type;

  const result = await prisma.proactiveJob.updateMany({
    where,
    data: { enabled: false },
  });
  return result.count;
}
