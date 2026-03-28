import type { PipelineContext, StateTransition } from "../types.js";
import { scoreAgent } from "../../agentQualityScorer.js";

/** Minimum composite score (0-100) to pass the quality gate. */
const QUALITY_GATE_THRESHOLD = 50;

/** Maximum regen attempts before accepting whatever we have. */
const MAX_REGEN_ATTEMPTS = 1;

/**
 * VALIDATING state: score agent quality across 8 SMS dimensions
 * and apply quality gate.
 *
 * If the score is below threshold and we haven't exhausted regen attempts,
 * send back to GENERATING for a retry.
 */
export async function handleValidation(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Scoring agent quality..." });

  if (!ctx.agentSpec || !ctx.agentCode) {
    ctx.errors.push({
      state: "VALIDATING",
      message: "No agent spec/code to validate",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  try {
    const { score, breakdown } = await scoreAgent(ctx.agentSpec, ctx.onProgress);
    ctx.qualityScore = score;
    ctx.qualityBreakdown = breakdown;
    ctx.pipelineSummary = `Agent "${ctx.agentSpec.name}" scored ${score}/100`;

    ctx.onProgress?.({
      type: "narrative",
      message: `Quality score: ${score}/100`,
    });

    // Quality gate check
    if (ctx.config.qualityGateEnabled && score < QUALITY_GATE_THRESHOLD) {
      if (ctx.qualityRegenAttempt < MAX_REGEN_ATTEMPTS) {
        ctx.qualityRegenAttempt += 1;
        ctx.onProgress?.({
          type: "narrative",
          message: `Score ${score} below threshold ${QUALITY_GATE_THRESHOLD}, regenerating...`,
        });
        return { nextState: "GENERATING" };
      }
      // Exhausted retries — accept and continue
      ctx.onProgress?.({
        type: "narrative",
        message: `Score ${score} below threshold but regen budget exhausted, continuing...`,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[validation] Quality scoring failed: ${msg}`);
    ctx.errors.push({
      state: "VALIDATING",
      message: `Scoring failed: ${msg}`,
      timestamp: Date.now(),
    });
    // Continue without score — don't block the pipeline
    ctx.qualityScore = null;
    ctx.pipelineSummary = `Agent "${ctx.agentSpec.name}" — quality scoring skipped`;
  }

  return { nextState: "REVIEWING" };
}
