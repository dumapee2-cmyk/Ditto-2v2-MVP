import { prisma } from "../../db.js";
import type { PipelineContext, StateTransition } from "../types.js";
import type { PipelineRunArtifact } from "../../../types/index.js";
import { DEFAULT_AGENT_CONFIG } from "../../../types/index.js";

/**
 * FINALIZING state: persist the generated agent to the database,
 * create pipeline run record, and build the final result.
 */
export async function handleFinalize(ctx: PipelineContext): Promise<StateTransition> {
  if (!ctx.agentSpec) {
    ctx.errors.push({
      state: "FINALIZING",
      message: "No agent spec available — reasoning/planning must complete first",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  if (!ctx.agentCode) {
    ctx.errors.push({
      state: "FINALIZING",
      message: "No agent code available — cannot finalize without code",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  ctx.onProgress?.({ type: "status", message: "Saving agent..." });

  const agentConfig = ctx.agentConfig ?? DEFAULT_AGENT_CONFIG;

  // Build pipeline artifact if not already set
  if (!ctx.pipelineArtifact) {
    ctx.pipelineArtifact = {
      run_id: ctx.runId,
      stages: ctx.stateHistory.map((s) => s.state),
      selected_candidate: "balanced",
      candidates: ctx.qualityBreakdown
        ? [{ id: "balanced", quality_score: ctx.qualityScore ?? 0, quality_breakdown: ctx.qualityBreakdown }]
        : [],
      repaired: ctx.reviewRepairAttempt > 0,
    };
  }

  // Persist agent — retry on connection pool timeout
  let agent;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[finalize] Retry DB write attempt ${attempt}/3 — reconnecting...`);
        await prisma.$disconnect();
        await prisma.$connect();
      }
      agent = await prisma.agent.create({
        data: {
          name: ctx.agentSpec.name,
          description: ctx.agentSpec.description,
          spec: ctx.agentSpec as object,
          original_prompt: ctx.prompt,
          generated_code: ctx.agentCode,
          agent_config: agentConfig as object,
          latest_quality_score: ctx.qualityScore,
          latest_pipeline_summary: ctx.pipelineSummary,
        },
      });
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 3 && (msg.includes("connection pool") || msg.includes("Timed out") || msg.includes("Connection refused"))) {
        console.warn(`[finalize] DB write failed (attempt ${attempt}): ${msg}`);
        continue;
      }
      throw e;
    }
  }
  if (!agent) throw new Error("[finalize] All DB write attempts failed");

  // Best-effort pipeline run persistence
  if (ctx.pipelineArtifact) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO pipeline_runs (id, agent_id, prompt, intent, artifact, quality_score, quality_breakdown, state_history, total_duration_ms, repair_count, final_state, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9, $10, $11, NOW())`,
        ctx.pipelineArtifact.run_id,
        agent.id,
        ctx.prompt,
        JSON.stringify(ctx.intent),
        JSON.stringify(ctx.pipelineArtifact),
        ctx.qualityScore ?? 0,
        JSON.stringify(ctx.qualityBreakdown ?? {}),
        JSON.stringify(ctx.stateHistory),
        ctx.stateHistory.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
        0,
        "COMPLETE",
      );
    } catch (e) {
      console.warn("pipeline_runs insert skipped:", e);
    }
  }

  // Persist degraded marker
  if (ctx.degraded && ctx.pipelineSummary && !ctx.pipelineSummary.includes("[degraded")) {
    ctx.pipelineSummary += " [degraded]";
  }

  // Build final result
  ctx.result = {
    id: agent.id,
    short_id: agent.short_id,
    name: agent.name,
    description: agent.description,
    spec: ctx.agentSpec,
    generated_code: ctx.agentCode ?? undefined,
    agent_config: agentConfig,
    pipeline_run_id: ctx.pipelineArtifact?.run_id,
    quality_score: ctx.qualityScore ?? undefined,
    quality_breakdown: ctx.qualityBreakdown ?? undefined,
    latest_pipeline_summary: ctx.pipelineSummary ?? undefined,
  };

  return { nextState: "COMPLETE" };
}
